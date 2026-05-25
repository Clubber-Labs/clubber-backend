import {
  Prisma,
  type Subscription,
  type SubscriptionStatus,
} from '@prisma/client'
import { env } from '../../lib/env'
import { prisma } from '../../lib/prisma'
import { stripe } from '../../lib/stripe'
import {
  isEventProcessed,
  markEventProcessedTx,
  recalculateUserPremiumTx,
  upsertSubscriptionTx,
} from './billing.repository'

// Tipos locais mínimos pros payloads do Stripe que usamos. O SDK Node 22+
// não expõe tipos via namespace (StripeEvent etc.) — usar shape próprio
// desacopla nosso código do caminho interno do SDK.
type StripeEvent = {
  id: string
  type: string
  created: number
  data: { object: unknown }
}

type StripeCheckoutSession = {
  id: string
  mode?: string
  subscription?: string | StripeSubscriptionLike | null
  customer?: string | { id: string }
  metadata?: Record<string, string> | null
}

type StripeInvoice = {
  subscription?: string | { id: string } | null
}

/**
 * Mapeia status do Stripe pro nosso enum.
 */
function mapStatus(stripeStatus: string): SubscriptionStatus {
  switch (stripeStatus) {
    case 'trialing':
      return 'TRIALING'
    case 'active':
      return 'ACTIVE'
    case 'past_due':
      return 'PAST_DUE'
    case 'canceled':
      return 'CANCELED'
    case 'incomplete':
      return 'INCOMPLETE'
    case 'incomplete_expired':
      return 'INCOMPLETE_EXPIRED'
    case 'unpaid':
      return 'UNPAID'
    default:
      return 'INCOMPLETE'
  }
}

type StripeSubscriptionLike = {
  id: string
  customer: string | { id: string }
  status: string
  items?: {
    data: Array<{
      price: { id: string }
      // Stripe API 2025-XX-XX moveu current_period_* da subscription pro item.
      // Fallback no nível raiz mantém compat com versões antigas e fixtures.
      current_period_start?: number
      current_period_end?: number
    }>
  }
  trial_end?: number | null
  current_period_start?: number | null
  current_period_end?: number | null
  cancel_at_period_end: boolean
  canceled_at?: number | null
  metadata?: Record<string, string> | null
}

type SubscriptionFields = {
  stripeSubscriptionId: string
  stripePriceId: string
  status: SubscriptionStatus
  trialEndsAt: Date | null
  currentPeriodStart: Date
  currentPeriodEnd: Date
  cancelAtPeriodEnd: boolean
  canceledAt: Date | null
}

function mapStripeSubscription(
  sub: StripeSubscriptionLike,
): SubscriptionFields {
  const firstItem = sub.items?.data?.[0]
  // API recente (2025+) moveu current_period_* da subscription pro item.
  // Fallback no nível raiz mantém compat com versões antigas e fixtures.
  // Em trial sem cobrança ainda, ambos podem ser null — usar trial_end ou
  // now() como fallback final, evita Invalid Date.
  const periodStart =
    firstItem?.current_period_start ?? sub.current_period_start ?? null
  const periodEnd =
    firstItem?.current_period_end ??
    sub.current_period_end ??
    sub.trial_end ??
    null

  if (periodStart === null || periodEnd === null) {
    // Cenário não esperado em produção: log pra investigar payloads anômalos.
    // Cai pro fallback de `new Date()` (now) — não-bloqueante, evita Invalid Date.
    console.warn(
      '[billing] mapStripeSubscription sem current_period_*, usando fallback now()',
      {
        subscriptionId: sub.id,
        status: sub.status,
        periodStart,
        periodEnd,
      },
    )
  }

  return {
    stripeSubscriptionId: sub.id,
    stripePriceId: firstItem?.price?.id ?? '',
    status: mapStatus(sub.status),
    trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
    currentPeriodStart: periodStart ? new Date(periodStart * 1000) : new Date(),
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : new Date(),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
  }
}

function extractCustomerId(sub: StripeSubscriptionLike): string | null {
  if (!sub.customer) return null
  return typeof sub.customer === 'string' ? sub.customer : sub.customer.id
}

/**
 * Compara timestamps em segundos (Stripe.event.created tem precisão segundo).
 * Comparar em ms direto descartaria eventos legítimos por causa do
 * truncamento. Retorna true se `event` é estritamente mais antigo que `last`.
 */
function isEventOlder(event: Date, last: Date): boolean {
  return Math.floor(event.getTime() / 1000) < Math.floor(last.getTime() / 1000)
}

/**
 * Processa um evento já verificado. Toda a mutação local (Subscription +
 * User.isPremium + WebhookEvent) acontece em uma única $transaction —
 * atomicidade garantida.
 *
 * Idempotência via INSERT-first em webhook_events com constraint unique.
 * Se P2002 estourar, evento já foi processado por outra request paralela.
 *
 * Ordering check: compara event.created (Stripe) com Subscription.lastSyncedAt
 * — se incoming é mais velho, descarta silenciosamente (Stripe não garante
 * ordering).
 */
/**
 * Pre-resolve dados que exigem chamada externa ao Stripe ANTES de abrir a
 * transação local. Regra do plano: nunca chamar Stripe SDK dentro de
 * `prisma.$transaction` (poderia segurar uma conexão do pool por até 10s
 * em caso de lentidão upstream). Retorna o objeto completo da subscription
 * relevante (ou null se o evento não precisa de mutação local).
 */
async function preResolveSubscription(
  event: StripeEvent,
): Promise<StripeSubscriptionLike | null> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as StripeCheckoutSession
      if (session.mode !== 'subscription') return null
      const subId =
        typeof session.subscription === 'string'
          ? session.subscription
          : session.subscription?.id
      if (!subId) return null
      if (typeof session.subscription === 'object' && session.subscription) {
        return session.subscription as unknown as StripeSubscriptionLike
      }
      return (await stripe.subscriptions.retrieve(
        subId,
      )) as unknown as StripeSubscriptionLike
    }

    case 'invoice.payment_succeeded':
    case 'invoice.payment_failed': {
      const invoice = event.data.object as StripeInvoice & {
        subscription?: string | { id: string } | null
      }
      const subId =
        typeof invoice.subscription === 'string'
          ? invoice.subscription
          : invoice.subscription?.id
      if (!subId) return null
      return (await stripe.subscriptions.retrieve(
        subId,
      )) as unknown as StripeSubscriptionLike
    }

    default:
      // Eventos de customer.subscription.{created,updated,deleted} já vêm com
      // o objeto completo em event.data.object — sem necessidade de fetch.
      return null
  }
}

type StripeSetupIntentLike = {
  customer?: string | { id: string } | null
  payment_method?: string | { id: string } | null
}

/**
 * Side-effect externo do setup_intent.succeeded: define o novo cartão como
 * default_payment_method do Customer (Stripe NÃO faz isso automaticamente
 * só por anexar o método via SetupIntent). Sem essa chamada, renovações
 * futuras continuariam cobrando o cartão antigo.
 *
 * Roda FORA da $transaction (regra: nunca Stripe dentro de tx). Idempotente:
 * chamar 2x com mesmo customer/payment_method é no-op.
 */
async function applySetupIntentSucceeded(event: StripeEvent): Promise<void> {
  const intent = event.data.object as StripeSetupIntentLike
  const customerId =
    typeof intent.customer === 'string' ? intent.customer : intent.customer?.id
  const paymentMethodId =
    typeof intent.payment_method === 'string'
      ? intent.payment_method
      : intent.payment_method?.id
  if (!customerId || !paymentMethodId) return

  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  })
}

async function applyEvent(event: StripeEvent): Promise<void> {
  const eventCreated = new Date(event.created * 1000)

  // FORA da transação: chamadas externas ao Stripe. Mantém a tx limpa de
  // I/O remoto (cumpre regra "nunca chamar Stripe dentro de $transaction").
  const preResolved = await preResolveSubscription(event)

  if (event.type === 'setup_intent.succeeded') {
    await applySetupIntentSucceeded(event)
  }

  await prisma.$transaction(
    async (tx) => {
      await markEventProcessedTx(tx, {
        stripeEventId: event.id,
        type: event.type,
        payload: event as unknown as Prisma.InputJsonValue,
      })

      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as StripeCheckoutSession
          if (session.mode !== 'subscription') return
          if (!preResolved) return

          const customerId =
            typeof session.customer === 'string'
              ? session.customer
              : session.customer?.id
          if (!customerId) return

          // Anti-spoofing: descobrir userId pelo `customerId` (vinculado ao
          // user pelo nosso /billing/checkout antes desta session existir),
          // NÃO pelo metadata. metadata pode ser forjado por insider com
          // acesso ao Stripe Dashboard. customerId no DB é fonte de verdade.
          const user = await tx.user.findUnique({
            where: { stripeCustomerId: customerId },
            select: { id: true },
          })
          if (!user) {
            console.warn(
              '[billing] checkout.session.completed sem user vinculado ao customerId',
              { customerId, sessionId: session.id },
            )
            return
          }

          const fields = mapStripeSubscription(preResolved)

          // Ordering check (igual aos outros cases): se já existe uma
          // subscription local mais nova, descarta o checkout retroativo.
          // Cenário: subscription.deleted chega ANTES do checkout.completed
          // por causa de retry/rede; sem isso, o checkout reativa premium
          // incorretamente.
          const existingForCheckout = await tx.subscription.findUnique({
            where: { stripeSubscriptionId: fields.stripeSubscriptionId },
          })
          if (
            existingForCheckout &&
            isEventOlder(eventCreated, existingForCheckout.lastSyncedAt)
          )
            return

          await upsertSubscriptionTx(tx, {
            userId: user.id,
            ...fields,
            lastSyncedAt: eventCreated,
          })

          // Recalcula isPremium baseado em TODAS as subscriptions do user,
          // não só na desta operação. User pode ter outra subscription
          // ativa em paralelo (raro mas permitido pelo schema).
          await recalculateUserPremiumTx(tx, user.id)
          return
        }

        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted': {
          const sub = event.data.object as unknown as StripeSubscriptionLike
          const fields = mapStripeSubscription(sub)

          const existing = await tx.subscription.findUnique({
            where: { stripeSubscriptionId: fields.stripeSubscriptionId },
          })

          // Ordering check: se evento é mais velho que último sync, descarta.
          if (existing && isEventOlder(eventCreated, existing.lastSyncedAt))
            return

          // Anti-spoofing: priorizar lookup por customerId (DB) em vez de
          // metadata. Se já houver subscription local, manter o userId dela.
          let userId: string | null = existing?.userId ?? null
          if (!userId) {
            const customerId = extractCustomerId(sub)
            if (!customerId) return // sem customer, sem vínculo possível
            const user = await tx.user.findUnique({
              where: { stripeCustomerId: customerId },
              select: { id: true },
            })
            userId = user?.id ?? null
          }
          if (!userId) return // não conseguiu vincular ao user — ignora

          await upsertSubscriptionTx(tx, {
            userId,
            ...fields,
            lastSyncedAt: eventCreated,
          })

          await recalculateUserPremiumTx(tx, userId)
          return
        }

        case 'invoice.payment_succeeded':
        case 'invoice.payment_failed': {
          if (!preResolved) return
          const fields = mapStripeSubscription(preResolved)

          const existing = await tx.subscription.findUnique({
            where: { stripeSubscriptionId: fields.stripeSubscriptionId },
          })
          if (!existing) return

          if (isEventOlder(eventCreated, existing.lastSyncedAt)) return

          await upsertSubscriptionTx(tx, {
            userId: existing.userId,
            ...fields,
            lastSyncedAt: eventCreated,
          })

          await recalculateUserPremiumTx(tx, existing.userId)
          return
        }

        case 'setup_intent.succeeded': {
          // Side-effect (atualizar default payment method no Stripe) é
          // executado fora da transação, em applyEvent(). Aqui só registra
          // como processado.
          return
        }

        default:
          // Evento não tratado: registro de idempotência foi feito, mas sem efeito.
          return
      }
    },
    { timeout: 10_000, maxWait: 2_000 },
  )
}

/**
 * Entrypoint do webhook. Verifica assinatura, decide idempotência e aplica
 * em transação. Lança statusCode pra controller responder.
 */
export async function processStripeWebhook(
  rawBody: Buffer,
  signature: string | undefined,
): Promise<void> {
  if (!signature) {
    throw { statusCode: 400, message: 'Missing Stripe-Signature header' }
  }

  let event: StripeEvent
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    )
  } catch {
    throw { statusCode: 400, message: 'Invalid signature' }
  }

  // Short-circuit otimista: se já processamos, retorna sem tx
  if (await isEventProcessed(event.id)) return

  try {
    await applyEvent(event)
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      // Race com outra request paralela que registrou o evento entre o
      // short-circuit e o INSERT. Idempotência via DB resolve.
      return
    }
    throw err
  }
}

export type { Subscription }
