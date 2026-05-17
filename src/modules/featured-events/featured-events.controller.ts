import type { FastifyReply, FastifyRequest } from 'fastify'
import type {
  CreateFeaturedEventBody,
  FeaturedEventFeatureParams,
  FeaturedEventParams,
} from './featured-events.schema'
import {
  addFeaturedEvent,
  cancelFeaturedEvent,
} from './featured-events.service'

export async function postFeaturedEvent(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as FeaturedEventParams
  const body = request.body as CreateFeaturedEventBody
  const feature = await addFeaturedEvent(id, body, request.user.sub)
  return reply.status(201).send(feature)
}

export async function deleteFeaturedEvent(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id, featureId } = request.params as FeaturedEventFeatureParams
  await cancelFeaturedEvent(id, featureId, request.user.sub)
  return reply.status(204).send()
}
