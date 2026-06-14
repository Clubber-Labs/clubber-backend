import type { FastifyReply, FastifyRequest } from 'fastify'
import type { CreateCheckoutBody } from './billing.schema'
import {
  cancelSubscription,
  createCheckoutSession,
  createSetupIntent,
  createSubscriptionIntent,
  getSubscription,
  resumeSubscription,
} from './billing.service'
import { processStripeWebhook } from './billing.webhook'

export async function postCheckout(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  // Cast do body (padrão dominante dos controllers do projeto): o handler é
  // função nomeada separada da rota, então não herda a inferência do
  // ZodTypeProvider — a validação real é feita pelo `schema` na rota.
  const body = request.body as CreateCheckoutBody
  const result = await createCheckoutSession(request.user.sub, body)
  return reply.status(201).send(result)
}

export async function postSubscribe(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const result = await createSubscriptionIntent(request.user.sub)
  return reply.status(201).send(result)
}

export async function getSubscriptionHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const sub = await getSubscription(request.user.sub)
  return reply.status(200).send(sub)
}

export async function postCancel(request: FastifyRequest, reply: FastifyReply) {
  await cancelSubscription(request.user.sub)
  return reply.status(204).send()
}

export async function postResume(request: FastifyRequest, reply: FastifyReply) {
  await resumeSubscription(request.user.sub)
  return reply.status(204).send()
}

export async function postPaymentMethod(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const result = await createSetupIntent(request.user.sub)
  return reply.status(200).send(result)
}

export async function postWebhook(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const rawBody = (request as FastifyRequest & { rawBody?: Buffer }).rawBody
  const signature = request.headers['stripe-signature']
  const signatureValue = Array.isArray(signature) ? signature[0] : signature

  if (!rawBody) {
    return reply.status(400).send({ message: 'Missing raw body' })
  }

  await processStripeWebhook(rawBody, signatureValue)
  return reply.status(200).send({ received: true })
}
