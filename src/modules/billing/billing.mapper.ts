import type { SubscriptionStatus } from '@prisma/client'

/**
 * Anti-corruption layer entre o Stripe e o nosso domínio. ÚNICO ponto onde
 * "stripês" (shapes do SDK, campos que migram entre versões de API, união
 * `string | { id }`) é traduzido para tipos do domínio. Não importa `prisma`
 * nem `stripe` — funções puras, testáveis isoladamente.
 *
 * O SDK Node 22+ não expõe os tipos de evento via namespace (StripeEvent etc.),
 * então mantemos shapes próprios mínimos. Isso também desacopla o resto do
 * código do caminho interno do SDK.
 */

export type StripeEvent = {
  id: string
  type: string
  created: number
  data: { object: unknown }
}

export type StripeCheckoutSession = {
  id: string
  mode?: string
  subscription?: string | StripeSubscriptionLike | null
  customer?: string | { id: string }
  metadata?: Record<string, string> | null
}

export type StripeInvoice = {
  subscription?: string | { id: string } | null
}

export type StripeSubscriptionLike = {
  id: string
  // Nullable de propósito: em payloads anômalos do Stripe `customer` pode vir
  // ausente. extractCustomerId trata o caso; o tipo reflete a defensividade
  // pra ninguém remover a guarda confiando num não-null que não existe.
  customer: string | { id: string } | null | undefined
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
  // `string | { id }` conforme expandido ou não. Em trial criado pelo
  // PaymentSheet costuma vir null: o cartão entra depois, via SetupIntent, e o
  // backend grava o default no Customer (não na subscription).
  default_payment_method?: string | { id: string } | null
  metadata?: Record<string, string> | null
}

export type StripeSetupIntentLike = {
  customer?: string | { id: string } | null
  payment_method?: string | { id: string } | null
}

export type SubscriptionFields = {
  stripeSubscriptionId: string
  stripePriceId: string
  status: SubscriptionStatus
  trialEndsAt: Date | null
  currentPeriodStart: Date
  currentPeriodEnd: Date
  cancelAtPeriodEnd: boolean
  canceledAt: Date | null
  defaultPaymentMethodId: string | null
}

/**
 * Mapeia status do Stripe pro nosso enum.
 */
export function mapStatus(stripeStatus: string): SubscriptionStatus {
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

// Retorna null quando o payload não tem priceId — uma subscription sem preço
// não é acionável (não dá pra persistir Subscription coerente). O caller
// descarta o evento. Em produção (produto de preço único) isso nunca ocorre;
// o guard cobre payloads anômalos sem gravar `stripePriceId: ''` no banco.
export function mapStripeSubscription(
  sub: StripeSubscriptionLike,
): SubscriptionFields | null {
  const firstItem = sub.items?.data?.[0]
  const priceId = firstItem?.price?.id
  if (!priceId) {
    console.warn(
      '[billing] mapStripeSubscription sem priceId, descartando evento',
      { subscriptionId: sub.id, status: sub.status },
    )
    return null
  }
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
    stripePriceId: priceId,
    status: mapStatus(sub.status),
    trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
    currentPeriodStart: periodStart ? new Date(periodStart * 1000) : new Date(),
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : new Date(),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
    defaultPaymentMethodId: idFromRef(sub.default_payment_method),
  }
}

/** Normaliza referência do Stripe (`string | { id } | null | undefined`) pro id. */
function idFromRef(
  ref: string | { id: string } | null | undefined,
): string | null {
  if (!ref) return null
  return typeof ref === 'string' ? ref : ref.id
}

export function extractCustomerId(sub: StripeSubscriptionLike): string | null {
  return idFromRef(sub.customer)
}

/**
 * Extrai customer + payment method de um setup_intent.succeeded. Retorna null
 * se faltar qualquer um — sem os dois não dá pra anexar o cartão nem creditar
 * o trial.
 */
export function extractSetupIntentRefs(
  intent: StripeSetupIntentLike,
): { customerId: string; paymentMethodId: string } | null {
  const customerId = idFromRef(intent.customer)
  const paymentMethodId = idFromRef(intent.payment_method)
  if (!customerId || !paymentMethodId) return null
  return { customerId, paymentMethodId }
}

/**
 * Compara timestamps em segundos (Stripe.event.created tem precisão segundo).
 * Comparar em ms direto descartaria eventos legítimos por causa do
 * truncamento. Retorna true se `event` é estritamente mais antigo que `last`.
 */
export function isEventOlder(event: Date, last: Date): boolean {
  return Math.floor(event.getTime() / 1000) < Math.floor(last.getTime() / 1000)
}
