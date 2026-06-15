import type { FastifyInstance } from 'fastify'
import Stripe from 'stripe'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { stripe } from '../../lib/stripe'
import { buildApp } from '../../test/app'
import { makeSubscription, makeUser } from '../../test/factories'
import { testPrisma } from '../../test/prisma'
import {
  findActiveSubscriptionByUserId,
  hasAnyPreviousSubscription,
  isEventProcessed,
  markEventProcessedTx,
  recalculateUserPremiumTx,
  upsertSubscriptionTx,
} from './billing.repository'
import {
  cancelSubscription,
  createCheckoutSession,
  createSetupIntent,
  createSubscriptionIntent,
  getSubscription,
  resumeSubscription,
  terminateBillingForUser,
} from './billing.service'
import { processStripeWebhook } from './billing.webhook'

// vi.mock é hoisted — aplica antes dos imports estáticos acima.
// Shape unificado cobre service (customers/checkout/subscriptions/setupIntents)
// e webhook (webhooks.constructEvent). Repository não importa stripe, então o
// mock global é inócuo pra ele.
vi.mock('../../lib/stripe', () => ({
  STRIPE_API_VERSION: '2026-05-27.dahlia',
  stripe: {
    customers: {
      create: vi.fn(),
      retrieve: vi.fn(),
      update: vi.fn(),
      del: vi.fn(),
    },
    checkout: { sessions: { create: vi.fn() } },
    subscriptions: { create: vi.fn(), update: vi.fn(), retrieve: vi.fn() },
    setupIntents: { create: vi.fn() },
    ephemeralKeys: { create: vi.fn() },
    webhooks: { constructEvent: vi.fn() },
    errors: {
      StripeAPIError: class StripeAPIError extends Error {},
      StripeConnectionError: class StripeConnectionError extends Error {},
      StripeSignatureVerificationError: class extends Error {},
    },
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
})

afterAll(async () => {
  await testPrisma.$disconnect()
})

// ─── Fixtures de eventos Stripe (usadas nos testes de webhook) ───────────────

function checkoutSessionCompletedFixture(opts: {
  userId: string
  customerId: string
  subscriptionId: string
  eventId?: string
  createdSec?: number
  status?: string
}) {
  return {
    id: opts.eventId ?? `evt_checkout_${Date.now()}`,
    type: 'checkout.session.completed',
    created: opts.createdSec ?? Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: 'cs_test_123',
        mode: 'subscription',
        customer: opts.customerId,
        subscription: {
          id: opts.subscriptionId,
          customer: opts.customerId,
          status: opts.status ?? 'trialing',
          items: {
            data: [{ price: { id: 'price_test' } }],
          },
          trial_end: Math.floor(Date.now() / 1000) + 7 * 86400,
          current_period_start: Math.floor(Date.now() / 1000),
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
          cancel_at_period_end: false,
          canceled_at: null,
          // Checkout web coleta o cartão antes de completar → PM na subscription.
          default_payment_method: 'pm_checkout',
        },
        metadata: { userId: opts.userId },
      },
    },
    // biome-ignore lint/suspicious/noExplicitAny: fixture de payload Stripe
  } as any
}

function subscriptionDeletedFixture(opts: {
  subscriptionId: string
  customerId: string
  userId: string
  eventId?: string
  createdSec?: number
}) {
  return {
    id: opts.eventId ?? `evt_deleted_${Date.now()}`,
    type: 'customer.subscription.deleted',
    created: opts.createdSec ?? Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: opts.subscriptionId,
        customer: opts.customerId,
        status: 'canceled',
        items: { data: [{ price: { id: 'price_test' } }] },
        current_period_start: Math.floor(Date.now() / 1000) - 86400,
        current_period_end: Math.floor(Date.now() / 1000),
        cancel_at_period_end: false,
        canceled_at: Math.floor(Date.now() / 1000),
        metadata: { userId: opts.userId },
      },
    },
    // biome-ignore lint/suspicious/noExplicitAny: fixture de payload Stripe
  } as any
}

function subscriptionUpdatedFixture(opts: {
  subscriptionId: string
  customerId: string
  userId: string
  cancelAtPeriodEnd?: boolean
  status?: string
  eventId?: string
  createdSec?: number
}) {
  return {
    id: opts.eventId ?? `evt_updated_${Date.now()}`,
    type: 'customer.subscription.updated',
    created: opts.createdSec ?? Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: opts.subscriptionId,
        customer: opts.customerId,
        status: opts.status ?? 'active',
        items: { data: [{ price: { id: 'price_test' } }] },
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
        cancel_at_period_end: opts.cancelAtPeriodEnd ?? false,
        canceled_at: null,
        metadata: { userId: opts.userId },
      },
    },
    // biome-ignore lint/suspicious/noExplicitAny: fixture de payload Stripe
  } as any
}

function subscriptionCreatedFixture(opts: {
  subscriptionId: string
  customerId: string
  userId: string
  status?: string
  defaultPaymentMethod?: string | null
  eventId?: string
}) {
  return {
    id: opts.eventId ?? `evt_created_${Date.now()}`,
    type: 'customer.subscription.created',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: opts.subscriptionId,
        customer: opts.customerId,
        status: opts.status ?? 'trialing',
        items: { data: [{ price: { id: 'price_test' } }] },
        trial_end: Math.floor(Date.now() / 1000) + 7 * 86400,
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 7 * 86400,
        cancel_at_period_end: false,
        canceled_at: null,
        default_payment_method: opts.defaultPaymentMethod ?? null,
        metadata: { userId: opts.userId },
      },
    },
    // biome-ignore lint/suspicious/noExplicitAny: fixture de payload Stripe
  } as any
}

// ─── Repository ──────────────────────────────────────────────────────────────

describe('repository', () => {
  describe('findActiveSubscriptionByUserId', () => {
    it('retorna TRIALING com cartão (defaultPaymentMethodId)', async () => {
      const user = await makeUser()
      const sub = await makeSubscription(user.id, {
        status: 'TRIALING',
        defaultPaymentMethodId: 'pm_test',
      })

      const found = await findActiveSubscriptionByUserId(user.id)

      expect(found?.id).toBe(sub.id)
    })

    it('NÃO retorna TRIALING órfão (sem cartão) — não trava o retry no 409', async () => {
      const user = await makeUser()
      await makeSubscription(user.id, {
        status: 'TRIALING',
        defaultPaymentMethodId: null,
      })

      const found = await findActiveSubscriptionByUserId(user.id)

      expect(found).toBeNull()
    })

    it('retorna subscription quando status é ACTIVE', async () => {
      const user = await makeUser()
      const sub = await makeSubscription(user.id, { status: 'ACTIVE' })

      const found = await findActiveSubscriptionByUserId(user.id)

      expect(found?.id).toBe(sub.id)
    })

    it('retorna subscription quando status é PAST_DUE', async () => {
      const user = await makeUser()
      const sub = await makeSubscription(user.id, { status: 'PAST_DUE' })

      const found = await findActiveSubscriptionByUserId(user.id)

      expect(found?.id).toBe(sub.id)
    })

    it('retorna null quando status é CANCELED', async () => {
      const user = await makeUser()
      await makeSubscription(user.id, { status: 'CANCELED' })

      const found = await findActiveSubscriptionByUserId(user.id)

      expect(found).toBeNull()
    })

    it('retorna null quando usuário não tem nenhuma subscription', async () => {
      const user = await makeUser()

      const found = await findActiveSubscriptionByUserId(user.id)

      expect(found).toBeNull()
    })

    it('quando há múltiplas subscriptions, retorna a mais recente por startedAt', async () => {
      const user = await makeUser()
      await makeSubscription(user.id, {
        stripeSubscriptionId: 'sub_old',
        status: 'CANCELED',
      })
      const newSub = await makeSubscription(user.id, {
        stripeSubscriptionId: 'sub_new',
        status: 'ACTIVE',
      })

      const found = await findActiveSubscriptionByUserId(user.id)

      expect(found?.id).toBe(newSub.id)
    })
  })

  describe('recalculateUserPremiumTx', () => {
    it('seta isPremium=true quando user tem subscription ACTIVE', async () => {
      const user = await makeUser({ isPremium: false })
      await makeSubscription(user.id, { status: 'ACTIVE' })

      await testPrisma.$transaction(async (tx) => {
        await recalculateUserPremiumTx(tx, user.id)
      })

      const updated = await testPrisma.user.findUnique({
        where: { id: user.id },
      })
      expect(updated?.isPremium).toBe(true)
    })

    it('seta isPremium=false quando todas subscriptions são CANCELED', async () => {
      const user = await makeUser({ isPremium: true })
      await makeSubscription(user.id, {
        stripeSubscriptionId: 'sub_a',
        status: 'CANCELED',
      })
      await makeSubscription(user.id, {
        stripeSubscriptionId: 'sub_b',
        status: 'CANCELED',
      })

      await testPrisma.$transaction(async (tx) => {
        await recalculateUserPremiumTx(tx, user.id)
      })

      const updated = await testPrisma.user.findUnique({
        where: { id: user.id },
      })
      expect(updated?.isPremium).toBe(false)
    })

    it('mantém isPremium=true se UMA subscription está ativa (mesmo com outra cancelada)', async () => {
      const user = await makeUser({ isPremium: true })
      await makeSubscription(user.id, {
        stripeSubscriptionId: 'sub_old',
        status: 'CANCELED',
      })
      await makeSubscription(user.id, {
        stripeSubscriptionId: 'sub_new',
        status: 'TRIALING',
        defaultPaymentMethodId: 'pm_test',
      })

      await testPrisma.$transaction(async (tx) => {
        await recalculateUserPremiumTx(tx, user.id)
      })

      const updated = await testPrisma.user.findUnique({
        where: { id: user.id },
      })
      expect(updated?.isPremium).toBe(true)
    })

    it('TRIALING órfão (sem cartão) NÃO concede premium', async () => {
      // Bug original: o trial do PaymentSheet nasce 'trialing' sem cartão e
      // dava premium grátis. Sem defaultPaymentMethodId, não é premium.
      const user = await makeUser({ isPremium: true })
      await makeSubscription(user.id, {
        status: 'TRIALING',
        defaultPaymentMethodId: null,
      })

      await testPrisma.$transaction(async (tx) => {
        await recalculateUserPremiumTx(tx, user.id)
      })

      const updated = await testPrisma.user.findUnique({
        where: { id: user.id },
      })
      expect(updated?.isPremium).toBe(false)
    })

    it('TRIALING com cartão concede premium', async () => {
      const user = await makeUser({ isPremium: false })
      await makeSubscription(user.id, {
        status: 'TRIALING',
        defaultPaymentMethodId: 'pm_card',
      })

      await testPrisma.$transaction(async (tx) => {
        await recalculateUserPremiumTx(tx, user.id)
      })

      const updated = await testPrisma.user.findUnique({
        where: { id: user.id },
      })
      expect(updated?.isPremium).toBe(true)
    })
  })

  describe('hasAnyPreviousSubscription', () => {
    it('retorna false quando user nunca teve subscription', async () => {
      const user = await makeUser()

      const has = await hasAnyPreviousSubscription(user.id)

      expect(has).toBe(false)
    })

    it('retorna true se teve CANCELED com cartão (trial/assinatura real)', async () => {
      const user = await makeUser()
      await makeSubscription(user.id, {
        status: 'CANCELED',
        defaultPaymentMethodId: 'pm_test',
      })

      const has = await hasAnyPreviousSubscription(user.id)

      expect(has).toBe(true)
    })

    it('retorna false se o CANCELED foi um trial órfão (sem cartão) — não queima o trial', async () => {
      const user = await makeUser()
      await makeSubscription(user.id, {
        status: 'CANCELED',
        defaultPaymentMethodId: null,
      })

      const has = await hasAnyPreviousSubscription(user.id)

      expect(has).toBe(false)
    })

    it('retorna false para TRIALING órfão (sem cartão) — abandonar a sheet não queima o trial', async () => {
      const user = await makeUser()
      await makeSubscription(user.id, {
        status: 'TRIALING',
        defaultPaymentMethodId: null,
      })

      const has = await hasAnyPreviousSubscription(user.id)

      expect(has).toBe(false)
    })

    it('retorna true quando há subscription ativa', async () => {
      const user = await makeUser()
      await makeSubscription(user.id, { status: 'ACTIVE' })

      const has = await hasAnyPreviousSubscription(user.id)

      expect(has).toBe(true)
    })

    it('retorna false quando só existe INCOMPLETE (PaymentSheet aberta e abandonada)', async () => {
      // createSubscriptionIntent cria a subscription como default_incomplete
      // ANTES do pagamento; o webhook persiste a linha como INCOMPLETE. Quem
      // desistiu da sheet nunca pagou nem trialou — não pode queimar o trial.
      const user = await makeUser()
      await makeSubscription(user.id, { status: 'INCOMPLETE' })

      const has = await hasAnyPreviousSubscription(user.id)

      expect(has).toBe(false)
    })

    it('retorna false quando só existe INCOMPLETE_EXPIRED', async () => {
      const user = await makeUser()
      await makeSubscription(user.id, { status: 'INCOMPLETE_EXPIRED' })

      const has = await hasAnyPreviousSubscription(user.id)

      expect(has).toBe(false)
    })
  })

  describe('terminateBillingForUser', () => {
    it('é no-op quando user não tem stripeCustomerId', async () => {
      const user = await makeUser()

      const terminated = await terminateBillingForUser(user.id)

      expect(terminated).toBeNull()
      expect(stripe.customers.del).not.toHaveBeenCalled()
    })

    it('deleta o Customer no Stripe (cancela subscriptions + remove PII do gateway)', async () => {
      const user = await makeUser()
      await testPrisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: 'cus_term' },
      })
      vi.mocked(stripe.customers.del).mockResolvedValue({
        id: 'cus_term',
        deleted: true,
      } as never)

      // Retorna o customerId encerrado: o caller usa pra reparar o ponteiro
      // local se a anonimização não acontecer (corrida de reativação).
      await expect(terminateBillingForUser(user.id)).resolves.toBe('cus_term')

      expect(stripe.customers.del).toHaveBeenCalledWith('cus_term')
    })

    it('é idempotente: resource_missing (Customer já deletado) não lança', async () => {
      const user = await makeUser()
      await testPrisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: 'cus_gone' },
      })
      vi.mocked(stripe.customers.del).mockRejectedValue(
        new Stripe.errors.StripeInvalidRequestError({
          message: 'No such customer',
          code: 'resource_missing',
          // biome-ignore lint/suspicious/noExplicitAny: construtor raw do SDK
        } as any),
      )

      // Customer já não existe = mesmo desfecho do del bem-sucedido: retorna
      // o id pra o caller poder reparar o ponteiro local do mesmo jeito.
      await expect(terminateBillingForUser(user.id)).resolves.toBe('cus_gone')
    })

    it('falha do gateway vira 502 — caller decide o retry', async () => {
      const user = await makeUser()
      await testPrisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: 'cus_down' },
      })
      vi.mocked(stripe.customers.del).mockRejectedValue(
        new Stripe.errors.StripeAPIError({
          message: 'stripe down',
          // biome-ignore lint/suspicious/noExplicitAny: construtor raw do SDK
        } as any),
      )

      await expect(terminateBillingForUser(user.id)).rejects.toMatchObject({
        statusCode: 502,
      })
    })
  })

  describe('isEventProcessed + markEventProcessedTx', () => {
    it('retorna false quando evento ainda não foi registrado', async () => {
      const processed = await isEventProcessed('evt_not_seen_yet')
      expect(processed).toBe(false)
    })

    it('retorna true depois de markEventProcessedTx', async () => {
      await testPrisma.$transaction(async (tx) => {
        await markEventProcessedTx(tx, {
          stripeEventId: 'evt_test_idempotent',
          type: 'checkout.session.completed',
          payload: { foo: 'bar' },
        })
      })

      const processed = await isEventProcessed('evt_test_idempotent')
      expect(processed).toBe(true)
    })

    it('markEventProcessedTx duplicado estoura P2002 (unique violation)', async () => {
      await testPrisma.$transaction(async (tx) => {
        await markEventProcessedTx(tx, {
          stripeEventId: 'evt_test_duplicate',
          type: 'foo',
          payload: {},
        })
      })

      await expect(
        testPrisma.$transaction(async (tx) => {
          await markEventProcessedTx(tx, {
            stripeEventId: 'evt_test_duplicate',
            type: 'foo',
            payload: {},
          })
        }),
      ).rejects.toMatchObject({ code: 'P2002' })
    })
  })

  describe('upsertSubscriptionTx', () => {
    it('cria subscription quando stripeSubscriptionId é novo', async () => {
      const user = await makeUser()
      const now = new Date()
      const data = {
        userId: user.id,
        stripeSubscriptionId: 'sub_upsert_new',
        stripePriceId: 'price_test',
        status: 'TRIALING' as const,
        trialEndsAt: new Date(now.getTime() + 7 * 86_400_000),
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000),
        cancelAtPeriodEnd: false,
        canceledAt: null,
        defaultPaymentMethodId: null,
        lastSyncedAt: now,
      }

      await testPrisma.$transaction(async (tx) => {
        await upsertSubscriptionTx(tx, data)
      })

      const created = await testPrisma.subscription.findUnique({
        where: { stripeSubscriptionId: 'sub_upsert_new' },
      })
      expect(created?.userId).toBe(user.id)
      expect(created?.status).toBe('TRIALING')
    })

    it('atualiza subscription existente quando stripeSubscriptionId já existe', async () => {
      const user = await makeUser()
      await makeSubscription(user.id, {
        stripeSubscriptionId: 'sub_upsert_existing',
        status: 'TRIALING',
      })

      const now = new Date()
      await testPrisma.$transaction(async (tx) => {
        await upsertSubscriptionTx(tx, {
          userId: user.id,
          stripeSubscriptionId: 'sub_upsert_existing',
          stripePriceId: 'price_test',
          status: 'ACTIVE',
          trialEndsAt: null,
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000),
          cancelAtPeriodEnd: true,
          canceledAt: null,
          defaultPaymentMethodId: null,
          lastSyncedAt: now,
        })
      })

      const updated = await testPrisma.subscription.findUnique({
        where: { stripeSubscriptionId: 'sub_upsert_existing' },
      })
      expect(updated?.status).toBe('ACTIVE')
      expect(updated?.cancelAtPeriodEnd).toBe(true)
    })

    it('defaultPaymentMethodId é sticky: update com null não apaga o cartão já gravado', async () => {
      const user = await makeUser()
      await makeSubscription(user.id, {
        stripeSubscriptionId: 'sub_sticky',
        status: 'TRIALING',
        defaultPaymentMethodId: 'pm_locked',
      })

      // Evento posterior (ex.: subscription.updated do trial) traz PM null — não
      // pode zerar o cartão já carimbado pelo setup_intent nem revogar premium.
      const now = new Date()
      await testPrisma.$transaction(async (tx) => {
        await upsertSubscriptionTx(tx, {
          userId: user.id,
          stripeSubscriptionId: 'sub_sticky',
          stripePriceId: 'price_test',
          status: 'TRIALING',
          trialEndsAt: null,
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000),
          cancelAtPeriodEnd: false,
          canceledAt: null,
          defaultPaymentMethodId: null,
          lastSyncedAt: now,
        })
      })

      const updated = await testPrisma.subscription.findUnique({
        where: { stripeSubscriptionId: 'sub_sticky' },
      })
      expect(updated?.defaultPaymentMethodId).toBe('pm_locked')
    })
  })
})

// ─── Service ─────────────────────────────────────────────────────────────────

describe('service', () => {
  describe('createCheckoutSession', () => {
    it('cria Stripe Customer quando usuário não tem ainda', async () => {
      const user = await makeUser({ isPremium: false })
      vi.mocked(stripe.customers.create).mockResolvedValue({
        id: 'cus_new',
        // biome-ignore lint/suspicious/noExplicitAny: mock parcial do Stripe
      } as any)
      vi.mocked(stripe.checkout.sessions.create).mockResolvedValue({
        url: 'https://checkout.stripe.com/sess_123',
        // biome-ignore lint/suspicious/noExplicitAny: mock parcial do Stripe
      } as any)

      const result = await createCheckoutSession(user.id)

      expect(stripe.customers.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: user.email }),
        expect.objectContaining({
          idempotencyKey: expect.stringContaining('customer_'),
        }),
      )
      expect(result.url).toBe('https://checkout.stripe.com/sess_123')

      const refreshed = await testPrisma.user.findUnique({
        where: { id: user.id },
      })
      expect(refreshed?.stripeCustomerId).toBe('cus_new')
    })

    it('reusa Stripe Customer existente quando user já tem stripeCustomerId', async () => {
      const user = await makeUser()
      await testPrisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: 'cus_existing' },
      })
      vi.mocked(stripe.checkout.sessions.create).mockResolvedValue({
        url: 'https://checkout.stripe.com/sess_reuse',
        // biome-ignore lint/suspicious/noExplicitAny: mock parcial do Stripe
      } as any)

      await createCheckoutSession(user.id)

      expect(stripe.customers.create).not.toHaveBeenCalled()
      expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ customer: 'cus_existing' }),
        expect.objectContaining({
          idempotencyKey: expect.stringContaining('checkout_'),
        }),
      )
    })

    it('aplica trial_period_days=7 quando user nunca teve subscription', async () => {
      const user = await makeUser()
      vi.mocked(stripe.customers.create).mockResolvedValue({
        id: 'cus_a',
        // biome-ignore lint/suspicious/noExplicitAny: mock parcial do Stripe
      } as any)
      vi.mocked(stripe.checkout.sessions.create).mockResolvedValue({
        url: 'https://x',
        // biome-ignore lint/suspicious/noExplicitAny: mock parcial do Stripe
      } as any)

      await createCheckoutSession(user.id)

      expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          subscription_data: expect.objectContaining({
            trial_period_days: 7,
          }),
        }),
        expect.objectContaining({
          idempotencyKey: expect.stringContaining('checkout_'),
        }),
      )
    })

    it('aplica trial quando a única subscription anterior é INCOMPLETE (sheet abandonada)', async () => {
      const user = await makeUser()
      await makeSubscription(user.id, { status: 'INCOMPLETE' })
      vi.mocked(stripe.customers.create).mockResolvedValue({
        id: 'cus_a',
        // biome-ignore lint/suspicious/noExplicitAny: mock parcial do Stripe
      } as any)
      vi.mocked(stripe.checkout.sessions.create).mockResolvedValue({
        url: 'https://x',
        // biome-ignore lint/suspicious/noExplicitAny: mock parcial do Stripe
      } as any)

      await createCheckoutSession(user.id)

      expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          subscription_data: expect.objectContaining({
            trial_period_days: 7,
          }),
        }),
        expect.anything(),
      )
    })

    it('NÃO aplica trial quando user já teve subscription real (mitigação trial abuse)', async () => {
      const user = await makeUser()
      // Assinatura real anterior = teve cartão. CANCELED órfão (sem cartão) não
      // contaria — ver hasAnyPreviousSubscription.
      await makeSubscription(user.id, {
        status: 'CANCELED',
        defaultPaymentMethodId: 'pm_test',
      })
      vi.mocked(stripe.customers.create).mockResolvedValue({
        id: 'cus_a',
        // biome-ignore lint/suspicious/noExplicitAny: mock parcial do Stripe
      } as any)
      vi.mocked(stripe.checkout.sessions.create).mockResolvedValue({
        url: 'https://x',
        // biome-ignore lint/suspicious/noExplicitAny: mock parcial do Stripe
      } as any)

      await createCheckoutSession(user.id)

      const callArgs = vi.mocked(stripe.checkout.sessions.create).mock
        .calls[0][0]
      expect(callArgs?.subscription_data?.trial_period_days).toBeUndefined()
    })

    it('lança 409 quando user já tem subscription ativa', async () => {
      const user = await makeUser()
      await makeSubscription(user.id, { status: 'ACTIVE' })

      await expect(createCheckoutSession(user.id)).rejects.toMatchObject({
        statusCode: 409,
      })
      expect(stripe.checkout.sessions.create).not.toHaveBeenCalled()
    })

    it('lança 404 quando user não existe', async () => {
      await expect(
        createCheckoutSession('00000000-0000-0000-0000-000000000000'),
      ).rejects.toMatchObject({ statusCode: 404 })
    })

    it('lança 400 quando successUrl aponta pra host fora da allowlist', async () => {
      const user = await makeUser()

      await expect(
        createCheckoutSession(user.id, {
          successUrl: 'https://evil.com/steal-session',
        }),
      ).rejects.toMatchObject({ statusCode: 400 })
      expect(stripe.customers.create).not.toHaveBeenCalled()
      expect(stripe.checkout.sessions.create).not.toHaveBeenCalled()
    })

    it('lança 400 quando cancelUrl aponta pra host fora da allowlist', async () => {
      const user = await makeUser()

      await expect(
        createCheckoutSession(user.id, {
          cancelUrl: 'https://evil.com/cancel',
        }),
      ).rejects.toMatchObject({ statusCode: 400 })
    })

    it('aceita successUrl/cancelUrl em host permitido (allowlist)', async () => {
      const user = await makeUser()
      vi.mocked(stripe.customers.create).mockResolvedValue({
        id: 'cus_allow',
        // biome-ignore lint/suspicious/noExplicitAny: mock parcial do Stripe
      } as any)
      vi.mocked(stripe.checkout.sessions.create).mockResolvedValue({
        url: 'https://x',
        // biome-ignore lint/suspicious/noExplicitAny: mock parcial do Stripe
      } as any)

      await expect(
        createCheckoutSession(user.id, {
          successUrl: 'http://localhost:3000/success',
          cancelUrl: 'http://localhost:3000/canceled',
        }),
      ).resolves.toBeDefined()
    })
  })

  describe('createSubscriptionIntent (PaymentSheet)', () => {
    // biome-ignore lint/suspicious/noExplicitAny: mock parcial do Stripe
    function mockSubscriptionCreate(overrides: Record<string, any> = {}) {
      vi.mocked(stripe.subscriptions.create).mockResolvedValue({
        id: 'sub_ps_1',
        pending_setup_intent: null,
        latest_invoice: {
          confirmation_secret: { client_secret: 'pi_secret_123' },
        },
        ...overrides,
        // biome-ignore lint/suspicious/noExplicitAny: mock parcial do Stripe
      } as any)
      vi.mocked(stripe.ephemeralKeys.create).mockResolvedValue({
        secret: 'ek_test_123',
        // biome-ignore lint/suspicious/noExplicitAny: mock parcial do Stripe
      } as any)
    }

    it('sem trial: retorna client secret do PaymentIntent da 1ª invoice', async () => {
      const user = await makeUser()
      // Já teve assinatura real (com cartão) → sem trial no retry.
      await makeSubscription(user.id, {
        status: 'CANCELED',
        defaultPaymentMethodId: 'pm_test',
      })
      vi.mocked(stripe.customers.create).mockResolvedValue({
        id: 'cus_ps',
        // biome-ignore lint/suspicious/noExplicitAny: mock parcial do Stripe
      } as any)
      mockSubscriptionCreate()

      const result = await createSubscriptionIntent(user.id)

      expect(result).toMatchObject({
        subscriptionId: 'sub_ps_1',
        clientSecret: 'pi_secret_123',
        intentType: 'payment',
        customerId: 'cus_ps',
        ephemeralKey: 'ek_test_123',
      })
      // Sem trial (já teve subscription): não manda trial_period_days
      const params = vi.mocked(stripe.subscriptions.create).mock.calls[0][0]
      expect(params?.trial_period_days).toBeUndefined()
      expect(params?.payment_behavior).toBe('default_incomplete')
    })

    it('com trial: usa pending_setup_intent e marca intentType=setup', async () => {
      const user = await makeUser()
      vi.mocked(stripe.customers.create).mockResolvedValue({
        id: 'cus_trial',
        // biome-ignore lint/suspicious/noExplicitAny: mock parcial do Stripe
      } as any)
      mockSubscriptionCreate({
        pending_setup_intent: { client_secret: 'seti_secret_456' },
        latest_invoice: null,
      })

      const result = await createSubscriptionIntent(user.id)

      expect(result).toMatchObject({
        clientSecret: 'seti_secret_456',
        intentType: 'setup',
      })
      const params = vi.mocked(stripe.subscriptions.create).mock.calls[0][0]
      expect(params?.trial_period_days).toBe(7)
      // Abandono da sheet sem cartão: assinatura cancela ao fim do trial
      expect(params?.trial_settings?.end_behavior?.missing_payment_method).toBe(
        'cancel',
      )
    })

    it('reusa Stripe Customer existente e cria ephemeral key pra ele', async () => {
      const user = await makeUser()
      await testPrisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: 'cus_existing_ps' },
      })
      mockSubscriptionCreate()

      await createSubscriptionIntent(user.id)

      expect(stripe.customers.create).not.toHaveBeenCalled()
      expect(stripe.ephemeralKeys.create).toHaveBeenCalledWith(
        { customer: 'cus_existing_ps' },
        expect.objectContaining({ apiVersion: expect.any(String) }),
      )
    })

    it('lança 409 quando user já tem subscription ativa', async () => {
      const user = await makeUser()
      await makeSubscription(user.id, { status: 'ACTIVE' })

      await expect(createSubscriptionIntent(user.id)).rejects.toMatchObject({
        statusCode: 409,
      })
      expect(stripe.subscriptions.create).not.toHaveBeenCalled()
    })

    it('lança 404 quando user não existe', async () => {
      await expect(
        createSubscriptionIntent('00000000-0000-0000-0000-000000000000'),
      ).rejects.toMatchObject({ statusCode: 404 })
    })

    it('lança 502 quando payload do Stripe não traz client secret algum', async () => {
      const user = await makeUser()
      vi.mocked(stripe.customers.create).mockResolvedValue({
        id: 'cus_x',
        // biome-ignore lint/suspicious/noExplicitAny: mock parcial do Stripe
      } as any)
      mockSubscriptionCreate({
        pending_setup_intent: null,
        latest_invoice: null,
      })

      await expect(createSubscriptionIntent(user.id)).rejects.toMatchObject({
        statusCode: 502,
      })
    })

    it('mapeia erro de rede do Stripe pra 502', async () => {
      const user = await makeUser()
      vi.mocked(stripe.customers.create).mockResolvedValue({
        id: 'cus_x',
        // biome-ignore lint/suspicious/noExplicitAny: mock parcial do Stripe
      } as any)
      // Classe REAL do pacote stripe: o instanceof do wrapStripeError compara
      // com ela (o vi.mock cobre só o singleton lib/stripe, não o pacote).
      vi.mocked(stripe.subscriptions.create).mockRejectedValue(
        new Stripe.errors.StripeConnectionError({
          message: 'socket hang up',
          // biome-ignore lint/suspicious/noExplicitAny: construtor raw do SDK
        } as any),
      )

      await expect(createSubscriptionIntent(user.id)).rejects.toMatchObject({
        statusCode: 502,
      })
    })
  })

  describe('getSubscription', () => {
    it('retorna subscription ativa do user', async () => {
      const user = await makeUser()
      const sub = await makeSubscription(user.id, { status: 'ACTIVE' })

      const found = await getSubscription(user.id)

      expect(found.id).toBe(sub.id)
    })

    it('lança 404 quando user não tem subscription ativa', async () => {
      const user = await makeUser()

      await expect(getSubscription(user.id)).rejects.toMatchObject({
        statusCode: 404,
      })
    })

    it('lança 404 quando user só tem subscription cancelada', async () => {
      const user = await makeUser()
      await makeSubscription(user.id, { status: 'CANCELED' })

      await expect(getSubscription(user.id)).rejects.toMatchObject({
        statusCode: 404,
      })
    })
  })

  describe('cancelSubscription', () => {
    it('chama Stripe com cancel_at_period_end=true e atualiza local', async () => {
      const user = await makeUser()
      const sub = await makeSubscription(user.id, {
        stripeSubscriptionId: 'sub_to_cancel',
        status: 'ACTIVE',
      })
      vi.mocked(stripe.subscriptions.update).mockResolvedValue({
        id: 'sub_to_cancel',
        cancel_at_period_end: true,
        // biome-ignore lint/suspicious/noExplicitAny: mock parcial do Stripe
      } as any)

      await cancelSubscription(user.id)

      expect(stripe.subscriptions.update).toHaveBeenCalledWith(
        'sub_to_cancel',
        { cancel_at_period_end: true },
      )
      const updated = await testPrisma.subscription.findUnique({
        where: { id: sub.id },
      })
      expect(updated?.cancelAtPeriodEnd).toBe(true)
    })

    it('lança 404 quando user não tem subscription ativa', async () => {
      const user = await makeUser()

      await expect(cancelSubscription(user.id)).rejects.toMatchObject({
        statusCode: 404,
      })
      expect(stripe.subscriptions.update).not.toHaveBeenCalled()
    })
  })

  describe('resumeSubscription', () => {
    it('reverte cancelAtPeriodEnd quando ainda em período ativo', async () => {
      const user = await makeUser()
      const sub = await makeSubscription(user.id, {
        stripeSubscriptionId: 'sub_to_resume',
        status: 'ACTIVE',
        cancelAtPeriodEnd: true,
      })
      vi.mocked(stripe.subscriptions.update).mockResolvedValue({
        id: 'sub_to_resume',
        cancel_at_period_end: false,
        // biome-ignore lint/suspicious/noExplicitAny: mock parcial do Stripe
      } as any)

      await resumeSubscription(user.id)

      expect(stripe.subscriptions.update).toHaveBeenCalledWith(
        'sub_to_resume',
        { cancel_at_period_end: false },
      )
      const updated = await testPrisma.subscription.findUnique({
        where: { id: sub.id },
      })
      expect(updated?.cancelAtPeriodEnd).toBe(false)
    })

    it('lança 409 quando subscription não está com cancelAtPeriodEnd', async () => {
      const user = await makeUser()
      await makeSubscription(user.id, {
        status: 'ACTIVE',
        cancelAtPeriodEnd: false,
      })

      await expect(resumeSubscription(user.id)).rejects.toMatchObject({
        statusCode: 409,
      })
    })

    it('lança 404 quando user não tem subscription ativa', async () => {
      const user = await makeUser()

      await expect(resumeSubscription(user.id)).rejects.toMatchObject({
        statusCode: 404,
      })
    })
  })

  describe('createSetupIntent', () => {
    it('retorna client_secret pro frontend coletar novo cartão', async () => {
      const user = await makeUser()
      await testPrisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: 'cus_setup' },
      })
      vi.mocked(stripe.setupIntents.create).mockResolvedValue({
        id: 'seti_123',
        client_secret: 'seti_123_secret',
        // biome-ignore lint/suspicious/noExplicitAny: mock parcial do Stripe
      } as any)

      const result = await createSetupIntent(user.id)

      expect(stripe.setupIntents.create).toHaveBeenCalledWith({
        customer: 'cus_setup',
        usage: 'off_session',
      })
      expect(result.clientSecret).toBe('seti_123_secret')
    })

    it('lança 409 quando user não tem stripeCustomerId (nunca passou pelo checkout)', async () => {
      const user = await makeUser()

      await expect(createSetupIntent(user.id)).rejects.toMatchObject({
        statusCode: 409,
      })
      expect(stripe.setupIntents.create).not.toHaveBeenCalled()
    })
  })
})

// ─── Webhook ─────────────────────────────────────────────────────────────────

describe('processStripeWebhook', () => {
  describe('signing', () => {
    it('lança 400 quando assinatura inválida', async () => {
      vi.mocked(stripe.webhooks.constructEvent).mockImplementation(() => {
        throw new Error('Webhook signature verification failed')
      })

      await expect(
        processStripeWebhook(Buffer.from('payload'), 'invalid-sig'),
      ).rejects.toMatchObject({ statusCode: 400 })
    })
  })

  describe('checkout.session.completed', () => {
    it('cria Subscription e marca isPremium=true', async () => {
      const user = await makeUser({ isPremium: false })
      await testPrisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: 'cus_a' },
      })
      const event = checkoutSessionCompletedFixture({
        userId: user.id,
        customerId: 'cus_a',
        subscriptionId: 'sub_create_1',
      })
      vi.mocked(stripe.webhooks.constructEvent).mockReturnValue(event)

      await processStripeWebhook(Buffer.from('x'), 'valid-sig')

      const sub = await testPrisma.subscription.findUnique({
        where: { stripeSubscriptionId: 'sub_create_1' },
      })
      expect(sub).not.toBeNull()
      expect(sub?.status).toBe('TRIALING')

      const refreshed = await testPrisma.user.findUnique({
        where: { id: user.id },
      })
      expect(refreshed?.isPremium).toBe(true)
    })

    it('ignora silenciosamente quando customerId não tem user vinculado (anti-spoofing)', async () => {
      // Cenário: insider com acesso ao Stripe Dashboard cria Checkout Session
      // com customer próprio dele e metadata.userId apontando pra vítima.
      // Antes do fix, o handler usava metadata.userId e ativava premium pra
      // vítima. Agora busca pelo customerId — sem match no DB, ignora.
      const victim = await makeUser({ isPremium: false })

      const event = checkoutSessionCompletedFixture({
        userId: victim.id, // ← metadata.userId aponta pra victim (forjado)
        customerId: 'cus_attacker_owned', // ← customer do atacante, não vinculado
        subscriptionId: 'sub_spoof_attempt',
      })
      vi.mocked(stripe.webhooks.constructEvent).mockReturnValue(event)

      await processStripeWebhook(Buffer.from('x'), 'sig')

      // Nada acontece: nenhuma subscription criada, victim não vira premium
      const sub = await testPrisma.subscription.findUnique({
        where: { stripeSubscriptionId: 'sub_spoof_attempt' },
      })
      expect(sub).toBeNull()

      const refreshed = await testPrisma.user.findUnique({
        where: { id: victim.id },
      })
      expect(refreshed?.isPremium).toBe(false)
      expect(refreshed?.stripeCustomerId).toBeNull()

      // Evento ainda registrado em webhook_events (idempotência) — não reprocessa
      const stored = await testPrisma.webhookEvent.findUnique({
        where: { stripeEventId: event.id },
      })
      expect(stored).not.toBeNull()
    })

    it('idempotência: evento duplicado é no-op', async () => {
      const user = await makeUser()
      await testPrisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: 'cus_idem' },
      })
      const event = checkoutSessionCompletedFixture({
        userId: user.id,
        customerId: 'cus_idem',
        subscriptionId: 'sub_idem',
        eventId: 'evt_idem_test',
      })
      vi.mocked(stripe.webhooks.constructEvent).mockReturnValue(event)

      // Primeira chamada — processa
      await processStripeWebhook(Buffer.from('x'), 'sig')
      const firstCount = await testPrisma.subscription.count()

      // Segunda chamada (mesmo eventId) — deve ser no-op silencioso
      await processStripeWebhook(Buffer.from('x'), 'sig')
      const secondCount = await testPrisma.subscription.count()

      expect(secondCount).toBe(firstCount)
      // E só registrou o evento uma vez
      const events = await testPrisma.webhookEvent.findMany({
        where: { stripeEventId: 'evt_idem_test' },
      })
      expect(events).toHaveLength(1)
    })
  })

  describe('customer.subscription.created', () => {
    it('trial órfão (trialing sem cartão) cria a subscription mas NÃO concede premium', async () => {
      // Bug que motivou o fix: POST /billing/subscribe cria o trial 'trialing'
      // sem cartão e o subscription.created dispara na hora — não pode dar
      // premium antes do cartão entrar (via setup_intent.succeeded).
      const user = await makeUser({ isPremium: false })
      await testPrisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: 'cus_trial_orphan' },
      })
      const event = subscriptionCreatedFixture({
        subscriptionId: 'sub_trial_orphan',
        customerId: 'cus_trial_orphan',
        userId: user.id,
        status: 'trialing',
        defaultPaymentMethod: null,
      })
      vi.mocked(stripe.webhooks.constructEvent).mockReturnValue(event)

      await processStripeWebhook(Buffer.from('x'), 'sig')

      const sub = await testPrisma.subscription.findUnique({
        where: { stripeSubscriptionId: 'sub_trial_orphan' },
      })
      expect(sub?.status).toBe('TRIALING')
      expect(sub?.defaultPaymentMethodId).toBeNull()

      const refreshed = await testPrisma.user.findUnique({
        where: { id: user.id },
      })
      expect(refreshed?.isPremium).toBe(false)
    })
  })

  describe('customer.subscription.deleted', () => {
    it('desliga isPremium e marca subscription CANCELED', async () => {
      const user = await makeUser({ isPremium: true })
      await makeSubscription(user.id, {
        stripeSubscriptionId: 'sub_to_delete',
        status: 'ACTIVE',
      })
      const event = subscriptionDeletedFixture({
        subscriptionId: 'sub_to_delete',
        customerId: 'cus_x',
        userId: user.id,
      })
      vi.mocked(stripe.webhooks.constructEvent).mockReturnValue(event)

      await processStripeWebhook(Buffer.from('x'), 'sig')

      const sub = await testPrisma.subscription.findUnique({
        where: { stripeSubscriptionId: 'sub_to_delete' },
      })
      expect(sub?.status).toBe('CANCELED')
      expect(sub?.canceledAt).toBeInstanceOf(Date)

      const refreshed = await testPrisma.user.findUnique({
        where: { id: user.id },
      })
      expect(refreshed?.isPremium).toBe(false)
    })
  })

  describe('customer.subscription.updated', () => {
    it('sincroniza cancelAtPeriodEnd=true', async () => {
      const user = await makeUser({ isPremium: true })
      await makeSubscription(user.id, {
        stripeSubscriptionId: 'sub_to_update',
        status: 'ACTIVE',
        cancelAtPeriodEnd: false,
      })
      const event = subscriptionUpdatedFixture({
        subscriptionId: 'sub_to_update',
        customerId: 'cus_x',
        userId: user.id,
        cancelAtPeriodEnd: true,
        status: 'active',
      })
      vi.mocked(stripe.webhooks.constructEvent).mockReturnValue(event)

      await processStripeWebhook(Buffer.from('x'), 'sig')

      const sub = await testPrisma.subscription.findUnique({
        where: { stripeSubscriptionId: 'sub_to_update' },
      })
      expect(sub?.cancelAtPeriodEnd).toBe(true)
      expect(sub?.status).toBe('ACTIVE') // permanece active até o fim do período

      const refreshed = await testPrisma.user.findUnique({
        where: { id: user.id },
      })
      expect(refreshed?.isPremium).toBe(true) // ainda premium até period_end
    })
  })

  describe('setup_intent.succeeded', () => {
    it('atualiza default payment method do Customer no Stripe', async () => {
      // Fixture mínima: o handler só lê customer + payment_method do intent.
      const event = {
        id: `evt_setup_${Date.now()}`,
        type: 'setup_intent.succeeded',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'seti_test_123',
            customer: 'cus_setup',
            payment_method: 'pm_card_visa',
          },
        },
        // biome-ignore lint/suspicious/noExplicitAny: fixture de payload Stripe
      } as any
      vi.mocked(stripe.webhooks.constructEvent).mockReturnValue(event)

      await processStripeWebhook(Buffer.from('x'), 'sig')

      expect(stripe.customers.update).toHaveBeenCalledWith('cus_setup', {
        invoice_settings: { default_payment_method: 'pm_card_visa' },
      })
    })

    it('é no-op quando customer ou payment_method ausentes', async () => {
      const event = {
        id: `evt_setup_noop_${Date.now()}`,
        type: 'setup_intent.succeeded',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: { id: 'seti_noop', customer: null, payment_method: null },
        },
        // biome-ignore lint/suspicious/noExplicitAny: fixture de payload Stripe
      } as any
      vi.mocked(stripe.webhooks.constructEvent).mockReturnValue(event)

      await processStripeWebhook(Buffer.from('x'), 'sig')

      expect(stripe.customers.update).not.toHaveBeenCalled()
    })

    it('carimba o cartão no trial órfão do customer e destrava o premium', async () => {
      const user = await makeUser({ isPremium: false })
      await testPrisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: 'cus_trial_flip' },
      })
      // Trial órfão criado antes pelo subscription.created (sem cartão).
      const sub = await makeSubscription(user.id, {
        status: 'TRIALING',
        defaultPaymentMethodId: null,
      })
      const event = {
        id: `evt_setup_flip_${Date.now()}`,
        type: 'setup_intent.succeeded',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'seti_flip',
            customer: 'cus_trial_flip',
            payment_method: 'pm_card_visa',
          },
        },
        // biome-ignore lint/suspicious/noExplicitAny: fixture de payload Stripe
      } as any
      vi.mocked(stripe.webhooks.constructEvent).mockReturnValue(event)

      await processStripeWebhook(Buffer.from('x'), 'sig')

      const reloaded = await testPrisma.subscription.findUnique({
        where: { id: sub.id },
      })
      expect(reloaded?.defaultPaymentMethodId).toBe('pm_card_visa')

      const refreshed = await testPrisma.user.findUnique({
        where: { id: user.id },
      })
      expect(refreshed?.isPremium).toBe(true)
    })

    it('setup_intent.succeeded atrasado, com trial já CANCELED, NÃO destrava premium', async () => {
      // Replay tardio: user abandonou a sheet, missing_payment_method cancelou o
      // trial ao fim dos 7 dias, e o setup_intent.succeeded chega atrasado (o
      // Stripe reenvia por dias). O filtro status:'TRIALING' não toca a CANCELED
      // → segue sem cartão e sem premium.
      const user = await makeUser({ isPremium: false })
      await testPrisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: 'cus_late_setup' },
      })
      const sub = await makeSubscription(user.id, {
        status: 'CANCELED',
        defaultPaymentMethodId: null,
      })
      const event = {
        id: `evt_setup_late_${Date.now()}`,
        type: 'setup_intent.succeeded',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'seti_late',
            customer: 'cus_late_setup',
            payment_method: 'pm_card_visa',
          },
        },
        // biome-ignore lint/suspicious/noExplicitAny: fixture de payload Stripe
      } as any
      vi.mocked(stripe.webhooks.constructEvent).mockReturnValue(event)

      await processStripeWebhook(Buffer.from('x'), 'sig')

      const reloaded = await testPrisma.subscription.findUnique({
        where: { id: sub.id },
      })
      expect(reloaded?.status).toBe('CANCELED')
      expect(reloaded?.defaultPaymentMethodId).toBeNull()

      const refreshed = await testPrisma.user.findUnique({
        where: { id: user.id },
      })
      expect(refreshed?.isPremium).toBe(false)
    })
  })

  describe('ordering check', () => {
    it('descarta evento mais velho que lastSyncedAt', async () => {
      const user = await makeUser({ isPremium: true })
      const now = new Date()
      await makeSubscription(user.id, {
        stripeSubscriptionId: 'sub_ordering',
        status: 'ACTIVE',
        lastSyncedAt: now,
      })

      // Evento criado 1h atrás — mais antigo que lastSyncedAt
      const oldEvent = subscriptionDeletedFixture({
        subscriptionId: 'sub_ordering',
        customerId: 'cus_x',
        userId: user.id,
        createdSec: Math.floor(now.getTime() / 1000) - 3600,
      })
      vi.mocked(stripe.webhooks.constructEvent).mockReturnValue(oldEvent)

      await processStripeWebhook(Buffer.from('x'), 'sig')

      // Subscription NÃO deve ter mudado pra CANCELED (evento descartado)
      const sub = await testPrisma.subscription.findUnique({
        where: { stripeSubscriptionId: 'sub_ordering' },
      })
      expect(sub?.status).toBe('ACTIVE')

      const refreshed = await testPrisma.user.findUnique({
        where: { id: user.id },
      })
      expect(refreshed?.isPremium).toBe(true)
    })
  })
})

// ─── Routes E2E (via app.inject) ─────────────────────────────────────────────
// Cobre o wiring HTTP que os testes de service/webhook não exercem:
// autenticação (preHandler de auth), rate-limit (config da rota) e propagação
// do rawBody pro handler do webhook (plugin escopado em billingWebhookRoutes).

describe('routes E2E', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  describe('autenticação', () => {
    it('POST /billing/checkout retorna 401 sem token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/billing/checkout',
        payload: {},
      })
      expect(res.statusCode).toBe(401)
    })

    it('POST /billing/checkout retorna 201 com token válido', async () => {
      const user = await makeUser()
      vi.mocked(stripe.customers.create).mockResolvedValue({
        id: 'cus_e2e',
        // biome-ignore lint/suspicious/noExplicitAny: fixture parcial de Customer
      } as any)
      vi.mocked(stripe.checkout.sessions.create).mockResolvedValue({
        url: 'https://checkout.stripe.com/test_e2e',
        // biome-ignore lint/suspicious/noExplicitAny: fixture parcial de Session
      } as any)

      const token = app.jwt.sign({ sub: user.id })
      const res = await app.inject({
        method: 'POST',
        url: '/billing/checkout',
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      })

      expect(res.statusCode).toBe(201)
      expect(res.json()).toEqual({
        url: 'https://checkout.stripe.com/test_e2e',
      })
    })
  })

  describe('rate-limit', () => {
    it('POST /billing/checkout retorna 429 após 10 requests no minuto', async () => {
      const user = await makeUser()
      vi.mocked(stripe.customers.create).mockResolvedValue({
        id: 'cus_rl',
        // biome-ignore lint/suspicious/noExplicitAny: fixture parcial
      } as any)
      vi.mocked(stripe.checkout.sessions.create).mockResolvedValue({
        url: 'https://checkout.stripe.com/rl',
        // biome-ignore lint/suspicious/noExplicitAny: fixture parcial
      } as any)
      const token = app.jwt.sign({ sub: user.id })
      const headers = { authorization: `Bearer ${token}` }

      for (let i = 0; i < 10; i++) {
        const ok = await app.inject({
          method: 'POST',
          url: '/billing/checkout',
          headers,
          payload: {},
        })
        // Pode ser 201 (checkout criado) ou 409 (subscription criada no 1º
        // request) — ambos contam como "request processado" pro rate-limit.
        expect([201, 409]).toContain(ok.statusCode)
      }

      const blocked = await app.inject({
        method: 'POST',
        url: '/billing/checkout',
        headers,
        payload: {},
      })
      expect(blocked.statusCode).toBe(429)
    })
  })

  describe('raw body do webhook', () => {
    it('POST /webhooks/stripe propaga rawBody pro constructEvent e processa', async () => {
      const user = await makeUser()
      await testPrisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: 'cus_raw' },
      })
      const rawPayload = Buffer.from(
        JSON.stringify({ raw: 'payload', user: user.id }),
      )

      const event = checkoutSessionCompletedFixture({
        userId: user.id,
        customerId: 'cus_raw',
        subscriptionId: 'sub_raw_e2e',
        eventId: 'evt_raw_e2e',
      })
      vi.mocked(stripe.webhooks.constructEvent).mockReturnValue(event)

      const res = await app.inject({
        method: 'POST',
        url: '/webhooks/stripe',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': 't=1,v1=fake',
        },
        payload: rawPayload,
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ received: true })
      // constructEvent recebe o Buffer original (a verificação de assinatura
      // só passa se o byte stream chegou intacto ao handler)
      const [receivedBody, receivedSig] = vi.mocked(
        stripe.webhooks.constructEvent,
      ).mock.calls[0]
      expect(Buffer.isBuffer(receivedBody)).toBe(true)
      expect((receivedBody as Buffer).equals(rawPayload)).toBe(true)
      expect(receivedSig).toBe('t=1,v1=fake')

      const persisted = await testPrisma.webhookEvent.findUnique({
        where: { stripeEventId: 'evt_raw_e2e' },
      })
      expect(persisted).not.toBeNull()
    })

    it('POST /webhooks/stripe retorna 400 quando rawBody está ausente', async () => {
      // Sem payload, fastify-raw-body não popula request.rawBody;
      // o handler responde 400 antes de chamar a Stripe.
      const res = await app.inject({
        method: 'POST',
        url: '/webhooks/stripe',
        headers: { 'stripe-signature': 't=1,v1=fake' },
      })
      expect(res.statusCode).toBe(400)
    })
  })
})
