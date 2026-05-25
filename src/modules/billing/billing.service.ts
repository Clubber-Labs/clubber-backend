import Stripe from 'stripe'
import { env } from '../../lib/env'
import { prisma } from '../../lib/prisma'
import { stripe } from '../../lib/stripe'
import {
  findActiveSubscriptionByUserId,
  hasAnyPreviousSubscription,
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
  const user = await prisma.user.findUnique({ where: { id: userId } })
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

  let customerId = user.stripeCustomerId
  if (!customerId) {
    try {
      // idempotencyKey por userId protege contra race em requests concorrentes:
      // Stripe retorna o MESMO Customer pra retries dentro de 24h. Sem isso,
      // dois cliques simultâneos no botão "Subscribe" criavam 2 Customers,
      // o segundo update do DB vencia, e webhook do pagamento do primeiro
      // Customer não encontrava user → user pagava sem virar premium.
      const customer = await stripe.customers.create(
        {
          email: user.email,
          name: `${user.name} ${user.lastname}`.trim(),
          metadata: { userId: user.id },
        },
        { idempotencyKey: `customer_${user.id}` },
      )
      customerId = customer.id
      await prisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: customerId },
      })
    } catch (err) {
      wrapStripeError(err)
    }
  }

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

  await prisma.subscription.update({
    where: { id: sub.id },
    data: { cancelAtPeriodEnd: true },
  })
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

  await prisma.subscription.update({
    where: { id: sub.id },
    data: { cancelAtPeriodEnd: false },
  })
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
