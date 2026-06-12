import Stripe from 'stripe'
import { env } from '../../lib/env'
import { STRIPE_API_VERSION, stripe } from '../../lib/stripe'
import {
  mapStripeSubscription,
  type StripeSubscriptionLike,
} from './billing.mapper'
import {
  clearUserStripeCustomerIdIfMatches,
  findActiveSubscriptionByUserId,
  findUserById,
  findUserIsPremium,
  hasAnyPreviousSubscription,
  markSubscriptionCanceledTx,
  recalculateUserPremiumTx,
  runInBillingTransaction,
  setSubscriptionCancelAtPeriodEnd,
  updateUserStripeCustomerId,
  upsertSubscriptionTx,
} from './billing.repository'

/**
 * Converte erros do SDK do Stripe (rede/5xx) em 502 explícito, com mensagem
 * amigável. Outros erros (validation, auth, business) sobem normalmente.
 */
function wrapStripeError(err: unknown): never {
  if (
    err instanceof Stripe.errors.StripeAPIError ||
    err instanceof Stripe.errors.StripeConnectionError
  ) {
    throw {
      statusCode: 502,
      message:
        'Gateway de pagamento indisponível, tente novamente em alguns instantes.',
    }
  }
  throw err
}

async function findUserOrThrow(userId: string) {
  const user = await findUserById(userId)
  if (!user) throw { statusCode: 404, message: 'Usuário não encontrado' }
  return user
}

/**
 * Garante que uma URL de redirect (success/cancel) está em um host permitido.
 * Defesa contra open-redirect: sem isso, usuário hostil poderia mandar
 * `successUrl: https://evil.com/?...` e a Stripe redirecionaria a vítima
 * com `session_id` na query string.
 */
function assertAllowedRedirectUrl(
  url: string,
  kind: 'successUrl' | 'cancelUrl',
) {
  try {
    const parsed = new URL(url)
    if (!env.STRIPE_CHECKOUT_ALLOWED_REDIRECT_HOSTS.includes(parsed.host)) {
      throw {
        statusCode: 400,
        message: `${kind} aponta para host não permitido: ${parsed.host}`,
      }
    }
  } catch (err) {
    if (err && typeof err === 'object' && 'statusCode' in err) throw err
    throw { statusCode: 400, message: `${kind} é uma URL inválida` }
  }
}

/**
 * Garante que o user tem um Stripe Customer vinculado, criando se preciso.
 * idempotencyKey por userId protege contra race em requests concorrentes:
 * Stripe retorna o MESMO Customer pra retries dentro de 24h. Sem isso,
 * dois cliques simultâneos no botão "Subscribe" criavam 2 Customers,
 * o segundo update do DB vencia, e webhook do pagamento do primeiro
 * Customer não encontrava user → user pagava sem virar premium.
 */
async function ensureStripeCustomer(user: {
  id: string
  email: string
  name: string
  lastname: string
  stripeCustomerId: string | null
}): Promise<string> {
  if (user.stripeCustomerId) return user.stripeCustomerId

  try {
    const customer = await stripe.customers.create(
      {
        email: user.email,
        name: `${user.name} ${user.lastname}`.trim(),
        metadata: { userId: user.id },
      },
      { idempotencyKey: `customer_${user.id}` },
    )
    await updateUserStripeCustomerId(user.id, customer.id)
    return customer.id
  } catch (err) {
    return wrapStripeError(err)
  }
}

export async function createCheckoutSession(
  userId: string,
  overrides?: { successUrl?: string; cancelUrl?: string },
) {
  // Validar overrides ANTES de tudo (não criar Customer no Stripe à toa
  // se a URL é inválida).
  if (overrides?.successUrl) {
    assertAllowedRedirectUrl(overrides.successUrl, 'successUrl')
  }
  if (overrides?.cancelUrl) {
    assertAllowedRedirectUrl(overrides.cancelUrl, 'cancelUrl')
  }

  const user = await findUserOrThrow(userId)

  const existingActive = await findActiveSubscriptionByUserId(userId)
  if (existingActive) {
    throw {
      statusCode: 409,
      message: 'Usuário já tem uma assinatura ativa',
    }
  }

  const customerId = await ensureStripeCustomer(user)

  // Mitigação trial abuse: só concede trial se user nunca assinou antes
  const alreadyHadSubscription = await hasAnyPreviousSubscription(userId)
  const trialDays = alreadyHadSubscription ? undefined : 7

  try {
    // idempotencyKey com bucket de 1 minuto: bloqueia clicks duplicados em
    // sequência rápida (2 abas, dupla submissão), mas permite retentativas
    // legítimas após o intervalo. Stripe retorna a MESMA Session no bucket
    // ativo, evitando 2 Subscriptions paralelas pro mesmo user/intenção.
    const minuteBucket = Math.floor(Date.now() / 60_000)
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: env.STRIPE_PREMIUM_PRICE_ID, quantity: 1 }],
        success_url: overrides?.successUrl ?? env.STRIPE_CHECKOUT_SUCCESS_URL,
        cancel_url: overrides?.cancelUrl ?? env.STRIPE_CHECKOUT_CANCEL_URL,
        subscription_data: {
          ...(trialDays !== undefined && { trial_period_days: trialDays }),
          metadata: { userId: user.id },
        },
        metadata: { userId: user.id },
      },
      { idempotencyKey: `checkout_${user.id}_${minuteBucket}` },
    )

    return { url: session.url }
  } catch (err) {
    return wrapStripeError(err)
  }
}

export async function getSubscription(userId: string) {
  const sub = await findActiveSubscriptionByUserId(userId)
  if (!sub) {
    throw {
      statusCode: 404,
      message: 'Nenhuma assinatura ativa encontrada',
    }
  }
  return sub
}

/**
 * Contrato público do módulo billing para LEITURA do estado premium. Outros
 * módulos (ex.: spots) consomem por aqui — não pelo repository — pra não
 * acoplar na estrutura interna de dados do billing. O middleware requirePremium,
 * por ser interno ao módulo, lê direto do repository.
 */
export async function getUserPremiumStatus(userId: string): Promise<boolean> {
  return findUserIsPremium(userId)
}

export async function cancelSubscription(userId: string) {
  const sub = await findActiveSubscriptionByUserId(userId)
  if (!sub) {
    throw {
      statusCode: 404,
      message: 'Nenhuma assinatura ativa encontrada',
    }
  }

  try {
    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: true,
    })
  } catch (err) {
    wrapStripeError(err)
  }

  await setSubscriptionCancelAtPeriodEnd(sub.id, true)
}

export async function resumeSubscription(userId: string) {
  const sub = await findActiveSubscriptionByUserId(userId)
  if (!sub) {
    throw {
      statusCode: 404,
      message: 'Nenhuma assinatura ativa encontrada',
    }
  }

  if (!sub.cancelAtPeriodEnd) {
    throw {
      statusCode: 409,
      message: 'Assinatura não está marcada para cancelamento',
    }
  }

  try {
    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: false,
    })
  } catch (err) {
    wrapStripeError(err)
  }

  await setSubscriptionCancelAtPeriodEnd(sub.id, false)
}

/**
 * Fluxo PaymentSheet (mobile nativo): cria a Subscription com
 * `payment_behavior: 'default_incomplete'` e devolve o client secret que o
 * app usa pra confirmar o pagamento na PaymentSheet — sem browser.
 *
 * - Sem trial: a 1ª invoice nasce aberta e o secret vem de
 *   `latest_invoice.confirmation_secret` (PaymentIntent da invoice).
 * - Com trial: não há cobrança imediata; Stripe gera `pending_setup_intent`
 *   pra coletar o cartão. `trial_settings.end_behavior.missing_payment_method:
 *   'cancel'` garante que, se o user abandonar a sheet sem cadastrar cartão,
 *   a assinatura cancela ao fim do trial (não vira PAST_DUE cobrando ninguém).
 *
 * A ativação do premium continua 100% via webhook (subscription.created/
 * updated + invoice.payment_succeeded) — INCOMPLETE não conta como ativa,
 * então abandonar a sheet sem pagar não dá acesso.
 */
export async function createSubscriptionIntent(userId: string) {
  const user = await findUserOrThrow(userId)

  const existingActive = await findActiveSubscriptionByUserId(userId)
  if (existingActive) {
    throw {
      statusCode: 409,
      message: 'Usuário já tem uma assinatura ativa',
    }
  }

  const customerId = await ensureStripeCustomer(user)

  // Mitigação trial abuse: só concede trial se user nunca assinou antes
  const alreadyHadSubscription = await hasAnyPreviousSubscription(userId)
  const trialDays = alreadyHadSubscription ? undefined : 7

  // SDK 22+ não expõe `Stripe.Subscription` via namespace — inferir do client.
  let subscription: Awaited<ReturnType<typeof stripe.subscriptions.create>>
  try {
    // Mesmo bucket de idempotência do checkout: bloqueia dupla submissão
    // em sequência rápida, permite retentativa legítima após 1 minuto.
    const minuteBucket = Math.floor(Date.now() / 60_000)
    subscription = await stripe.subscriptions.create(
      {
        customer: customerId,
        items: [{ price: env.STRIPE_PREMIUM_PRICE_ID, quantity: 1 }],
        payment_behavior: 'default_incomplete',
        // Cartão confirmado na sheet vira default da subscription —
        // renovações futuras cobram dele sem passo extra.
        payment_settings: { save_default_payment_method: 'on_subscription' },
        ...(trialDays !== undefined && {
          trial_period_days: trialDays,
          trial_settings: {
            end_behavior: { missing_payment_method: 'cancel' },
          },
        }),
        metadata: { userId: user.id },
        expand: ['latest_invoice.confirmation_secret', 'pending_setup_intent'],
      },
      { idempotencyKey: `subscribe_${user.id}_${minuteBucket}` },
    )
  } catch (err) {
    return wrapStripeError(err)
  }

  const pendingSetupIntent =
    typeof subscription.pending_setup_intent === 'object'
      ? subscription.pending_setup_intent
      : null
  const latestInvoice =
    typeof subscription.latest_invoice === 'object'
      ? subscription.latest_invoice
      : null

  const intent = pendingSetupIntent
    ? { type: 'setup' as const, secret: pendingSetupIntent.client_secret }
    : {
        type: 'payment' as const,
        secret: latestInvoice?.confirmation_secret?.client_secret ?? null,
      }

  if (!intent.secret) {
    // Payload inesperado (sem secret em nenhum dos dois caminhos) — não dá
    // pra abrir a PaymentSheet. 502 orienta o app a tentar de novo.
    throw {
      statusCode: 502,
      message:
        'Gateway de pagamento indisponível, tente novamente em alguns instantes.',
    }
  }

  try {
    // Ephemeral key: credencial curta e escopada ao Customer que a
    // PaymentSheet usa pra ler/salvar métodos de pagamento — nunca expomos
    // a secret key ao app. Atrelada à versão de API do SDK nativo.
    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customerId },
      { apiVersion: STRIPE_API_VERSION },
    )

    return {
      subscriptionId: subscription.id,
      clientSecret: intent.secret,
      intentType: intent.type,
      customerId,
      ephemeralKey: ephemeralKey.secret,
    }
  } catch (err) {
    return wrapStripeError(err)
  }
}

export async function createSetupIntent(userId: string) {
  const user = await findUserOrThrow(userId)

  if (!user.stripeCustomerId) {
    throw {
      statusCode: 409,
      message:
        'Usuário ainda não tem cadastro no gateway. Faça um checkout antes de atualizar método de pagamento.',
    }
  }

  try {
    const intent = await stripe.setupIntents.create({
      customer: user.stripeCustomerId,
      usage: 'off_session',
    })
    return { clientSecret: intent.client_secret }
  } catch (err) {
    return wrapStripeError(err)
  }
}

/**
 * Encerramento do billing na exclusão de conta (LGPD): deletar o Customer no
 * Stripe cancela IMEDIATAMENTE todas as subscriptions dele e remove o PII
 * (e-mail/nome) que mantínhamos no gateway — o pedido de exclusão vale também
 * fora do nosso banco. Idempotente: `resource_missing` (Customer já deletado
 * numa tentativa anterior) conta como sucesso.
 *
 * Falhas reais sobem (502 via wrapStripeError): o caller (anonymizeAccount)
 * NÃO anonimiza a conta nesse caso — anonimizar sem cancelar deixaria o
 * gateway cobrando um titular que não existe mais. O reconciler de exclusão
 * tenta de novo no próximo tick.
 *
 * Retorna o customerId encerrado (null se não havia vínculo): o caller usa
 * pra reparar o ponteiro local quando a anonimização NÃO acontece (corrida de
 * reativação por login) — o Customer já morreu no gateway, então o ponteiro
 * não pode sobrar. `resource_missing` retorna o id pelo mesmo motivo.
 */
export async function terminateBillingForUser(
  userId: string,
): Promise<string | null> {
  const user = await findUserById(userId)
  if (!user?.stripeCustomerId) return null

  try {
    await stripe.customers.del(user.stripeCustomerId)
  } catch (err) {
    if (
      err instanceof Stripe.errors.StripeInvalidRequestError &&
      err.code === 'resource_missing'
    ) {
      return user.stripeCustomerId
    }
    return wrapStripeError(err)
  }
  return user.stripeCustomerId
}

/**
 * Desfaz o vínculo local com um Customer que sabidamente não existe mais no
 * Stripe. Usado pelo fluxo de exclusão de conta quando um login reativa a
 * conta na janela entre o cancel no gateway e a tx de anonimização: sem o
 * reparo, ensureStripeCustomer devolveria um ID morto e o próximo checkout
 * quebraria no gateway. Condicional ao id esperado (não sobrescreve um
 * vínculo recriado em paralelo).
 */
export async function unlinkStripeCustomer(
  userId: string,
  expectedCustomerId: string,
): Promise<void> {
  await clearUserStripeCustomerIdIfMatches(userId, expectedCustomerId)
}

/**
 * Re-sincroniza UMA subscription a partir do Stripe — fonte de verdade. Usado
 * pelo reconciler de sync como rede de segurança pra webhook perdido: em vez
 * de rebaixar localmente (inventaria estado — PAST_DUE com retry em andamento
 * é premium legítimo), pergunta ao gateway e aplica o que ele responder pelo
 * mesmo caminho do webhook (mapper → upsert → recálculo do premium).
 *
 * `resource_missing` = a subscription não existe mais no gateway (ex.:
 * Customer deletado) → cancela localmente. Outras falhas sobem; o reconciler
 * loga e tenta a mesma subscription no próximo tick (ela continua no WHERE).
 *
 * Stripe fora da transação (regra do módulo); lastSyncedAt = agora, então
 * webhooks atrasados mais velhos que o sync são descartados pelo ordering
 * check — o retrieve é sempre mais fresco que eles.
 */
export async function syncSubscriptionFromStripe(sub: {
  stripeSubscriptionId: string
  userId: string
}): Promise<void> {
  let payload: StripeSubscriptionLike
  try {
    payload = (await stripe.subscriptions.retrieve(
      sub.stripeSubscriptionId,
    )) as unknown as StripeSubscriptionLike
  } catch (err) {
    if (
      err instanceof Stripe.errors.StripeInvalidRequestError &&
      err.code === 'resource_missing'
    ) {
      const now = new Date()
      await runInBillingTransaction(async (tx) => {
        await markSubscriptionCanceledTx(tx, sub.stripeSubscriptionId, now)
        await recalculateUserPremiumTx(tx, sub.userId)
      })
      return
    }
    return wrapStripeError(err)
  }

  // Payload anômalo sem priceId: mapper loga e descarta — mantém o estado
  // local e a subscription volta no próximo tick.
  const fields = mapStripeSubscription(payload)
  if (!fields) return

  const syncedAt = new Date()
  await runInBillingTransaction(async (tx) => {
    await upsertSubscriptionTx(tx, {
      userId: sub.userId,
      ...fields,
      lastSyncedAt: syncedAt,
    })
    await recalculateUserPremiumTx(tx, sub.userId)
  })
}
