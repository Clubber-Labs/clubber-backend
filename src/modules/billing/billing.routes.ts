import type { FastifyInstance } from 'fastify'
import fastifyRawBody from 'fastify-raw-body'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { rateLimit } from '../../lib/rate-limit'
import {
  getPlanHandler,
  getSubscriptionHandler,
  postCancel,
  postCheckout,
  postPaymentMethod,
  postResume,
  postSubscribe,
  postWebhook,
} from './billing.controller'
import {
  createCheckoutBodySchema,
  planResponseSchema,
  subscriptionResponseSchema,
} from './billing.schema'

/**
 * Rotas autenticadas — body parsing JSON normal.
 */
export async function billingRoutes(app: FastifyInstance) {
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  const api = app.withTypeProvider<ZodTypeProvider>()

  api.post(
    '/billing/checkout',
    {
      schema: { body: createCheckoutBodySchema },
      onRequest: [app.authenticate],
      // Cria Stripe Customer + Checkout Session — chamadas externas pagas.
      // 10/min por chave (IP por default) é generoso pra UX legítima
      // (user retentando após erro) e bloqueia abuse.
      config: { rateLimit: rateLimit(10) },
    },
    postCheckout,
  )

  api.post(
    '/billing/subscribe',
    {
      onRequest: [app.authenticate],
      // Fluxo PaymentSheet (mobile): cria Subscription + ephemeral key —
      // mesmas chamadas externas pagas do checkout, mesmo limite.
      config: { rateLimit: rateLimit(10) },
    },
    postSubscribe,
  )

  api.get(
    '/billing/subscription',
    {
      onRequest: [app.authenticate],
      schema: { response: { 200: subscriptionResponseSchema } },
    },
    getSubscriptionHandler,
  )

  // GET barato e cacheado (preço lido do Stripe com TTL de módulo) — sem
  // rate-limit especial, igual ao /billing/subscription.
  api.get(
    '/billing/plan',
    {
      onRequest: [app.authenticate],
      schema: { response: { 200: planResponseSchema } },
    },
    getPlanHandler,
  )

  // Rotas que chamam a Stripe (consome cota da API + side effects):
  // 20/min por chave (IP por default) cobre UX legítima (retry após erro de
  // rede, troca de cartão depois de falha) e bloqueia spam autenticado —
  // ex. user hostil gerando SetupIntents em loop pra consumir quota nossa.
  const stripeWriteLimit = rateLimit(20)

  api.post(
    '/billing/cancel',
    { onRequest: [app.authenticate], config: { rateLimit: stripeWriteLimit } },
    postCancel,
  )

  api.post(
    '/billing/resume',
    { onRequest: [app.authenticate], config: { rateLimit: stripeWriteLimit } },
    postResume,
  )

  api.post(
    '/billing/payment-method',
    { onRequest: [app.authenticate], config: { rateLimit: stripeWriteLimit } },
    postPaymentMethod,
  )
}

/**
 * Rota do webhook — registrada em plugin escopado para ativar raw body
 * APENAS nela (resto do app continua com parser JSON). Sem auth — proteção
 * é via verificação de assinatura HMAC do Stripe.
 */
export async function billingWebhookRoutes(app: FastifyInstance) {
  await app.register(fastifyRawBody, {
    field: 'rawBody',
    global: false,
    encoding: false,
    runFirst: true,
  })

  app.post(
    '/webhooks/stripe',
    {
      config: {
        rawBody: true,
        // Stripe envia tipicamente <10 req/s pra um único endpoint.
        // 200/min cobre picos legítimos com folga e bloqueia flood:
        // requisições inválidas ainda gastariam CPU verificando signature.
        rateLimit: rateLimit(200),
      },
    },
    postWebhook,
  )
}
