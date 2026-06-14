import { env } from '../../lib/env'
import { stripe } from '../../lib/stripe'
import {
  extractCustomerId,
  extractSetupIntentRefs,
  isEventOlder,
  mapStripeSubscription,
  type StripeCheckoutSession,
  type StripeEvent,
  type StripeInvoice,
  type StripeSetupIntentLike,
  type StripeSubscriptionLike,
} from './billing.mapper'
import {
  findSubscriptionByStripeIdTx,
  findUserIdByStripeCustomerIdTx,
  isDuplicateWebhookEventError,
  isEventProcessed,
  markEventProcessedTx,
  recalculateUserPremiumTx,
  runInBillingTransaction,
  setTrialingPaymentMethodTx,
  upsertSubscriptionTx,
} from './billing.repository'

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

/**
 * Side-effect externo do setup_intent.succeeded: define o novo cartão como
 * default_payment_method do Customer (Stripe NÃO faz isso automaticamente
 * só por anexar o método via SetupIntent). Sem essa chamada, renovações
 * futuras continuariam cobrando o cartão antigo.
 *
 * Roda na FASE EXTERNA, fora da transação (regra: nunca chamar o Stripe dentro
 * de uma $transaction). Idempotente: chamar 2x com mesmo customer/payment_method
 * é no-op.
 */
async function applySetupIntentSucceeded(event: StripeEvent): Promise<void> {
  const refs = extractSetupIntentRefs(
    event.data.object as StripeSetupIntentLike,
  )
  if (!refs) return

  await stripe.customers.update(refs.customerId, {
    invoice_settings: { default_payment_method: refs.paymentMethodId },
  })
}

/**
 * FASE EXTERNA: concentra TODO o I/O com o Stripe de um evento (fetch da
 * subscription quando o payload não a traz inteira + side-effects como o
 * default payment method). Roda ANTES da transação para cumprir a regra
 * "nunca chamar Stripe dentro de $transaction". Retorna a subscription
 * pré-resolvida (ou null) que a fase local consome.
 *
 * Separar as fases por ASSINATURA (e não só pela ordem das linhas) torna a
 * invariante explícita: a fase local recebe `preResolved` pronto e não tem
 * como, por engano, chamar o Stripe.
 */
async function applyExternalEffects(
  event: StripeEvent,
): Promise<StripeSubscriptionLike | null> {
  if (event.type === 'setup_intent.succeeded') {
    await applySetupIntentSucceeded(event)
  }
  return preResolveSubscription(event)
}

/**
 * FASE LOCAL: toda a mutação (Subscription + User.isPremium + WebhookEvent)
 * numa única $transaction — atomicidade garantida. Não fala com o Stripe;
 * consome `preResolved` da fase externa. Todo acesso ao Prisma passa pelo
 * repository (funções *Tx), mantendo o handler como orquestração pura.
 *
 * Idempotência via INSERT-first em webhook_events (constraint unique): se
 * P2002 estourar, o evento já foi processado por outra request paralela.
 *
 * Ordering check: compara event.created (Stripe) com Subscription.lastSyncedAt
 * — se incoming é mais velho, descarta silenciosamente (Stripe não garante
 * ordering).
 */
async function applyLocalMutations(
  event: StripeEvent,
  eventCreated: Date,
  preResolved: StripeSubscriptionLike | null,
): Promise<void> {
  await runInBillingTransaction(async (tx) => {
    await markEventProcessedTx(tx, {
      stripeEventId: event.id,
      type: event.type,
      payload: event,
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
        const userId = await findUserIdByStripeCustomerIdTx(tx, customerId)
        if (!userId) {
          console.warn(
            '[billing] checkout.session.completed sem user vinculado ao customerId',
            { customerId, sessionId: session.id },
          )
          return
        }

        const fields = mapStripeSubscription(preResolved)
        if (!fields) return

        // Ordering check (igual aos outros cases): se já existe uma
        // subscription local mais nova, descarta o checkout retroativo.
        // Cenário: subscription.deleted chega ANTES do checkout.completed
        // por causa de retry/rede; sem isso, o checkout reativa premium
        // incorretamente.
        const existingForCheckout = await findSubscriptionByStripeIdTx(
          tx,
          fields.stripeSubscriptionId,
        )
        if (
          existingForCheckout &&
          isEventOlder(eventCreated, existingForCheckout.lastSyncedAt)
        )
          return

        await upsertSubscriptionTx(tx, {
          userId,
          ...fields,
          lastSyncedAt: eventCreated,
        })

        // Recalcula isPremium baseado em TODAS as subscriptions do user,
        // não só na desta operação. User pode ter outra subscription
        // ativa em paralelo (raro mas permitido pelo schema).
        await recalculateUserPremiumTx(tx, userId)
        return
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as unknown as StripeSubscriptionLike
        const fields = mapStripeSubscription(sub)
        if (!fields) return

        const existing = await findSubscriptionByStripeIdTx(
          tx,
          fields.stripeSubscriptionId,
        )

        // Ordering check: se evento é mais velho que último sync, descarta.
        if (existing && isEventOlder(eventCreated, existing.lastSyncedAt))
          return

        // Anti-spoofing: priorizar lookup por customerId (DB) em vez de
        // metadata. Se já houver subscription local, manter o userId dela.
        let userId: string | null = existing?.userId ?? null
        if (!userId) {
          const customerId = extractCustomerId(sub)
          if (!customerId) return // sem customer, sem vínculo possível
          userId = await findUserIdByStripeCustomerIdTx(tx, customerId)
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
        if (!fields) return

        const existing = await findSubscriptionByStripeIdTx(
          tx,
          fields.stripeSubscriptionId,
        )
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
        // O side-effect externo (default payment method no Customer) já rodou
        // em applyExternalEffects(). Aqui, na transação: o SetupIntent concluir
        // é o sinal de que o cartão entrou no trial — carimba o
        // defaultPaymentMethodId na subscription TRIALING e recalcula o premium
        // (sem o cartão, um trial não vale premium — ver recalculateUserPremiumTx).
        //
        // Sem ordering check (ao contrário dos outros cases): a mutação é
        // additive-only — só preenche defaultPaymentMethodId onde está null, sem
        // tocar status. Replay atrasado é idempotente (a 2ª passada filtra a
        // linha já carimbada → 0 linhas); e se o trial já virou CANCELED, o
        // filtro status:'TRIALING' não o toca.
        const refs = extractSetupIntentRefs(
          event.data.object as StripeSetupIntentLike,
        )
        if (!refs) return

        const userId = await findUserIdByStripeCustomerIdTx(tx, refs.customerId)
        if (!userId) {
          // Cartão confirmado mas sem user vinculado (Customer de outro
          // ambiente, deletado antes do evento, etc.): logar — senão "paguei e
          // não virei premium" vira um silêncio difícil de diagnosticar.
          console.warn(
            '[billing] setup_intent.succeeded sem user vinculado ao customerId',
            { customerId: refs.customerId },
          )
          return
        }

        await setTrialingPaymentMethodTx(tx, userId, refs.paymentMethodId)
        await recalculateUserPremiumTx(tx, userId)
        return
      }

      default:
        // Evento não tratado: registro de idempotência foi feito, mas sem efeito.
        return
    }
  })
}

/**
 * Aplica um evento já verificado: fase externa (Stripe I/O) e depois fase
 * local (mutação atômica). A separação garante que nenhuma chamada remota
 * acontece com uma conexão do pool segura pela transação.
 */
async function applyEvent(event: StripeEvent): Promise<void> {
  const eventCreated = new Date(event.created * 1000)
  const preResolved = await applyExternalEffects(event)
  await applyLocalMutations(event, eventCreated, preResolved)
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
    if (isDuplicateWebhookEventError(err)) {
      // Race com outra request paralela que registrou o evento entre o
      // short-circuit e o INSERT. Idempotência via DB resolve.
      return
    }
    throw err
  }
}
