import Stripe from 'stripe'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { stripe } from '../../lib/stripe'
import { makeSubscription, makeUser } from '../../test/factories'
import { testPrisma } from '../../test/prisma'
import { describeReconcilerTimer } from '../../test/reconciler-lifecycle'
import {
  reconcileOrphanStripeSubscriptions,
  reconcileStaleSubscriptions,
  startBillingSyncReconciler,
  stopBillingSyncReconciler,
} from './billing-sync.reconciler'

// O sync re-consulta o Stripe (fonte de verdade) — mock do singleton, sem
// rede em teste. `retrieve` re-sincroniza o que já existe local; `list`
// descobre o que nunca chegou (varredura de órfãs).
vi.mock('../../lib/stripe', () => ({
  STRIPE_API_VERSION: 'test',
  stripe: { subscriptions: { retrieve: vi.fn(), list: vi.fn() } },
}))

beforeEach(() => {
  vi.clearAllMocks()
})

afterAll(async () => {
  await testPrisma.$disconnect()
})

const GRACE_MS = 6 * 3600_000

function hoursAgo(h: number) {
  return new Date(Date.now() - h * 3600_000)
}

function stripeSubscriptionPayload(opts: {
  id: string
  status?: string
  periodEndSec?: number
  canceledAtSec?: number | null
}) {
  const nowSec = Math.floor(Date.now() / 1000)
  return {
    id: opts.id,
    customer: 'cus_sync',
    status: opts.status ?? 'active',
    items: {
      data: [
        {
          price: { id: 'price_test' },
          current_period_start: nowSec - 86_400,
          current_period_end: opts.periodEndSec ?? nowSec + 30 * 86_400,
        },
      ],
    },
    cancel_at_period_end: false,
    canceled_at: opts.canceledAtSec ?? null,
  }
}

describe('reconcileStaleSubscriptions', () => {
  it('webhook de cancelamento perdido: rebaixa pela verdade do Stripe', async () => {
    const user = await makeUser({ isPremium: true })
    const sub = await makeSubscription(user.id, {
      status: 'ACTIVE',
      currentPeriodEnd: hoursAgo(48),
      lastSyncedAt: hoursAgo(48),
    })
    vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(
      stripeSubscriptionPayload({
        id: sub.stripeSubscriptionId,
        status: 'canceled',
        periodEndSec: Math.floor(hoursAgo(48).getTime() / 1000),
        canceledAtSec: Math.floor(hoursAgo(47).getTime() / 1000),
      }) as never,
    )

    const result = await reconcileStaleSubscriptions(GRACE_MS)

    expect(result).toMatchObject({ due: 1, synced: 1, failed: 0 })
    const reloaded = await testPrisma.subscription.findUnique({
      where: { id: sub.id },
    })
    expect(reloaded?.status).toBe('CANCELED')
    expect(
      (await testPrisma.user.findUnique({ where: { id: user.id } }))?.isPremium,
    ).toBe(false)
  })

  it('webhook de renovação perdido: atualiza o período e mantém premium', async () => {
    const user = await makeUser({ isPremium: true })
    const sub = await makeSubscription(user.id, {
      status: 'ACTIVE',
      currentPeriodEnd: hoursAgo(24),
      lastSyncedAt: hoursAgo(24),
    })
    vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(
      stripeSubscriptionPayload({
        id: sub.stripeSubscriptionId,
        status: 'active',
      }) as never,
    )

    const result = await reconcileStaleSubscriptions(GRACE_MS)

    expect(result.synced).toBe(1)
    const reloaded = await testPrisma.subscription.findUnique({
      where: { id: sub.id },
    })
    expect(reloaded?.status).toBe('ACTIVE')
    // Período renovado: sai do WHERE — o próximo tick não a toca de novo.
    expect(reloaded?.currentPeriodEnd.getTime()).toBeGreaterThan(Date.now())
    expect(
      (await testPrisma.user.findUnique({ where: { id: user.id } }))?.isPremium,
    ).toBe(true)
  })

  it('respeita a tolerância: vencida há menos que o grace não é tocada', async () => {
    const user = await makeUser({ isPremium: true })
    await makeSubscription(user.id, {
      status: 'ACTIVE',
      currentPeriodEnd: hoursAgo(1), // < 6h de grace — renovação em andamento
    })

    const result = await reconcileStaleSubscriptions(GRACE_MS)

    expect(result.due).toBe(0)
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled()
  })

  it('resource_missing (subscription sumiu do gateway): cancela localmente', async () => {
    const user = await makeUser({ isPremium: true })
    const sub = await makeSubscription(user.id, {
      status: 'TRIALING',
      currentPeriodEnd: hoursAgo(12),
      lastSyncedAt: hoursAgo(12),
    })
    vi.mocked(stripe.subscriptions.retrieve).mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({
        message: 'No such subscription',
        code: 'resource_missing',
        // biome-ignore lint/suspicious/noExplicitAny: construtor raw do SDK
      } as any),
    )

    const result = await reconcileStaleSubscriptions(GRACE_MS)

    expect(result.synced).toBe(1)
    const reloaded = await testPrisma.subscription.findUnique({
      where: { id: sub.id },
    })
    expect(reloaded?.status).toBe('CANCELED')
    expect(
      (await testPrisma.user.findUnique({ where: { id: user.id } }))?.isPremium,
    ).toBe(false)
  })

  it('falha em uma subscription não derruba o lote', async () => {
    const userA = await makeUser({ isPremium: true })
    const userB = await makeUser({ isPremium: true })
    // A é mais antiga (orderBy currentPeriodEnd asc) — falha primeiro.
    await makeSubscription(userA.id, {
      status: 'ACTIVE',
      currentPeriodEnd: hoursAgo(72),
      lastSyncedAt: hoursAgo(72),
    })
    const subB = await makeSubscription(userB.id, {
      status: 'ACTIVE',
      currentPeriodEnd: hoursAgo(48),
      lastSyncedAt: hoursAgo(48),
    })
    vi.mocked(stripe.subscriptions.retrieve)
      .mockRejectedValueOnce(
        new Stripe.errors.StripeAPIError({
          message: 'stripe down',
          // biome-ignore lint/suspicious/noExplicitAny: construtor raw do SDK
        } as any),
      )
      .mockResolvedValueOnce(
        stripeSubscriptionPayload({
          id: subB.stripeSubscriptionId,
          status: 'canceled',
          periodEndSec: Math.floor(hoursAgo(48).getTime() / 1000),
        }) as never,
      )

    const result = await reconcileStaleSubscriptions(GRACE_MS)

    expect(result).toMatchObject({ due: 2, synced: 1, failed: 1 })
    // A intocada (retry no próximo tick); B rebaixada.
    expect(
      (await testPrisma.user.findUnique({ where: { id: userA.id } }))
        ?.isPremium,
    ).toBe(true)
    expect(
      (await testPrisma.user.findUnique({ where: { id: userB.id } }))
        ?.isPremium,
    ).toBe(false)
  })

  it('PAST_DUE em retry de cobrança segue premium após re-sync (nunca rebaixa por conta própria)', async () => {
    const user = await makeUser({ isPremium: true })
    const sub = await makeSubscription(user.id, {
      status: 'PAST_DUE',
      currentPeriodEnd: hoursAgo(72),
      lastSyncedAt: hoursAgo(72),
    })
    // Stripe ainda em retry: past_due com período vencido é estado legítimo.
    vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(
      stripeSubscriptionPayload({
        id: sub.stripeSubscriptionId,
        status: 'past_due',
        periodEndSec: Math.floor(hoursAgo(72).getTime() / 1000),
      }) as never,
    )

    const result = await reconcileStaleSubscriptions(GRACE_MS)

    expect(result.synced).toBe(1)
    const reloaded = await testPrisma.subscription.findUnique({
      where: { id: sub.id },
    })
    expect(reloaded?.status).toBe('PAST_DUE')
    expect(
      (await testPrisma.user.findUnique({ where: { id: user.id } }))?.isPremium,
    ).toBe(true)
    // lastSyncedAt avançou: sai do lote até o grace vencer de novo.
    expect(reloaded?.lastSyncedAt.getTime()).toBeGreaterThan(
      hoursAgo(1).getTime(),
    )
  })

  it('não re-consulta o Stripe dentro do grace após sync/webhook recente (anti re-poll)', async () => {
    const user = await makeUser({ isPremium: true })
    // Período vencido há dias, mas lastSyncedAt recente: um sync do tick
    // anterior (ou um webhook aplicado) já confirmou o estado — re-consultar
    // a cada tick queimaria cota do Stripe com PAST_DUE em retry de semanas.
    await makeSubscription(user.id, {
      status: 'PAST_DUE',
      currentPeriodEnd: hoursAgo(72),
      lastSyncedAt: hoursAgo(1),
    })

    const result = await reconcileStaleSubscriptions(GRACE_MS)

    expect(result.due).toBe(0)
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled()
  })

  it('não toca status que não entregam valor (CANCELED não re-sincroniza)', async () => {
    const user = await makeUser({ isPremium: false })
    await makeSubscription(user.id, {
      status: 'CANCELED',
      currentPeriodEnd: hoursAgo(100),
    })

    const result = await reconcileStaleSubscriptions(GRACE_MS)

    expect(result.due).toBe(0)
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled()
  })
})

const LOOKBACK_MS = 7 * 24 * 3600_000

function listedSubscriptionPayload(opts: {
  id: string
  customerId: string
  status?: string
  metadataUserId?: string
  customerDefaultPaymentMethod?: string | null
}) {
  const nowSec = Math.floor(Date.now() / 1000)
  return {
    ...stripeSubscriptionPayload({ id: opts.id, status: opts.status }),
    customer: {
      id: opts.customerId,
      invoice_settings: {
        default_payment_method: opts.customerDefaultPaymentMethod ?? null,
      },
    },
    trial_end: nowSec + 7 * 86_400,
    ...(opts.metadataUserId && { metadata: { userId: opts.metadataUserId } }),
  }
}

function mockList(...pages: unknown[][]) {
  const mock = vi.mocked(stripe.subscriptions.list)
  mock.mockReset()
  // Um list por status varrido (trialing, active) — devolve a página da vez.
  for (const data of pages) mock.mockResolvedValueOnce({ data } as never)
  mock.mockResolvedValue({ data: [] } as never)
}

async function userWithCustomer(customerId: string, isPremium = false) {
  const user = await makeUser({ isPremium })
  await testPrisma.user.update({
    where: { id: user.id },
    data: { stripeCustomerId: customerId },
  })
  return user
}

describe('reconcileOrphanStripeSubscriptions', () => {
  it('adota a assinatura cujo customer.subscription.created se perdeu', async () => {
    const user = await userWithCustomer('cus_orphan')
    mockList([
      listedSubscriptionPayload({
        id: 'sub_orphan',
        customerId: 'cus_orphan',
        status: 'trialing',
        customerDefaultPaymentMethod: 'pm_card',
      }),
    ])

    const result = await reconcileOrphanStripeSubscriptions(LOOKBACK_MS)

    expect(result).toMatchObject({ adopted: 1, failed: 0 })
    const created = await testPrisma.subscription.findUnique({
      where: { stripeSubscriptionId: 'sub_orphan' },
    })
    expect(created).toMatchObject({ userId: user.id, status: 'TRIALING' })
    // Cartão do trial mora no Customer (o SetupIntent grava lá, não na
    // subscription): sem carimbá-lo a adoção não concederia premium.
    expect(created?.defaultPaymentMethodId).toBe('pm_card')
    expect(
      (await testPrisma.user.findUnique({ where: { id: user.id } }))?.isPremium,
    ).toBe(true)
  })

  it('trial sem cartão é adotado mas NÃO concede premium', async () => {
    const user = await userWithCustomer('cus_nocard')
    mockList([
      listedSubscriptionPayload({
        id: 'sub_nocard',
        customerId: 'cus_nocard',
        status: 'trialing',
        customerDefaultPaymentMethod: null,
      }),
    ])

    const result = await reconcileOrphanStripeSubscriptions(LOOKBACK_MS)

    expect(result.adopted).toBe(1)
    expect(
      (await testPrisma.user.findUnique({ where: { id: user.id } }))?.isPremium,
    ).toBe(false)
  })

  it('assinatura já conhecida não é adotada de novo', async () => {
    const user = await userWithCustomer('cus_known')
    const existing = await makeSubscription(user.id, {
      stripeSubscriptionId: 'sub_known',
      status: 'ACTIVE',
    })
    mockList([
      listedSubscriptionPayload({
        id: 'sub_known',
        customerId: 'cus_known',
        status: 'active',
      }),
    ])

    const result = await reconcileOrphanStripeSubscriptions(LOOKBACK_MS)

    expect(result.adopted).toBe(0)
    const reloaded = await testPrisma.subscription.findUnique({
      where: { stripeSubscriptionId: 'sub_known' },
    })
    expect(reloaded?.id).toBe(existing.id)
  })

  it('customer sem usuário local é ignorado', async () => {
    mockList([
      listedSubscriptionPayload({
        id: 'sub_sem_dono',
        customerId: 'cus_desconhecido',
        status: 'active',
      }),
    ])

    const result = await reconcileOrphanStripeSubscriptions(LOOKBACK_MS)

    expect(result.adopted).toBe(0)
    expect(
      await testPrisma.subscription.findUnique({
        where: { stripeSubscriptionId: 'sub_sem_dono' },
      }),
    ).toBeNull()
  })

  it('vincula pelo customer do banco, nunca pelo metadata (anti-spoofing)', async () => {
    const dono = await userWithCustomer('cus_dono')
    const vitima = await makeUser()
    mockList([
      listedSubscriptionPayload({
        id: 'sub_spoof',
        customerId: 'cus_dono',
        status: 'active',
        metadataUserId: vitima.id,
      }),
    ])

    await reconcileOrphanStripeSubscriptions(LOOKBACK_MS)

    const created = await testPrisma.subscription.findUnique({
      where: { stripeSubscriptionId: 'sub_spoof' },
    })
    expect(created?.userId).toBe(dono.id)
    expect(
      (await testPrisma.user.findUnique({ where: { id: vitima.id } }))
        ?.isPremium,
    ).toBe(false)
  })

  it('payload anômalo não derruba o lote', async () => {
    const bom = await userWithCustomer('cus_bom')
    mockList([
      // Sem priceId: o mapper descarta e a varredura segue pras seguintes.
      {
        ...listedSubscriptionPayload({
          id: 'sub_ruim',
          customerId: 'cus_bom',
        }),
        items: { data: [] },
      },
      listedSubscriptionPayload({
        id: 'sub_bom',
        customerId: 'cus_bom',
        status: 'active',
      }),
    ])

    const result = await reconcileOrphanStripeSubscriptions(LOOKBACK_MS)

    expect(result.adopted).toBe(1)
    expect(
      await testPrisma.subscription.findUnique({
        where: { stripeSubscriptionId: 'sub_bom' },
      }),
    ).not.toBeNull()
    expect(
      (await testPrisma.user.findUnique({ where: { id: bom.id } }))?.isPremium,
    ).toBe(true)
  })

  it('erro do Stripe na varredura não derruba o tick', async () => {
    vi.mocked(stripe.subscriptions.list).mockReset()
    vi.mocked(stripe.subscriptions.list).mockRejectedValue(
      new Stripe.errors.StripeAPIError({
        message: 'stripe down',
        // biome-ignore lint/suspicious/noExplicitAny: construtor raw do SDK
      } as any),
    )

    await expect(
      reconcileOrphanStripeSubscriptions(LOOKBACK_MS),
    ).resolves.toMatchObject({ adopted: 0 })
  })
})

describeReconcilerTimer('billing-sync', {
  start: () => startBillingSyncReconciler(60_000, GRACE_MS, LOOKBACK_MS),
  stop: stopBillingSyncReconciler,
  intervalMs: 60_000,
})
