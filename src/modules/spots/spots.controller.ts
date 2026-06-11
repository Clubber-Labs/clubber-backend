import type { FastifyReply, FastifyRequest } from 'fastify'
import type {
  CreateSpotBody,
  ListSpotsQuery,
  SpotParam,
  SuggestionsBody,
  UpdateSpotBody,
} from './spots.schema'
import {
  cancelSpot,
  createSpot,
  editSpot,
  generateSuggestions,
  getSpot,
  joinSpot,
  listSpotsOnMap,
} from './spots.service'

export async function postSpot(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as CreateSpotBody
  const spot = await createSpot(request.user.sub, body)
  return reply.status(201).send(spot)
}

export async function getSpots(request: FastifyRequest, reply: FastifyReply) {
  const query = request.query as ListSpotsQuery
  const spots = await listSpotsOnMap(request.user?.sub ?? null, query)
  return reply.send(spots)
}

export async function getSpotById(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as SpotParam
  const spot = await getSpot(request.user?.sub ?? null, id)
  return reply.send(spot)
}

export async function postJoinSpot(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as SpotParam
  const { conversationId, created } = await joinSpot(request.user.sub, id)
  // 201 no primeiro ingresso (cria a participação); 200 nos repetidos.
  return reply.status(created ? 201 : 200).send({ conversationId })
}

export async function postSuggestions(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const body = request.body as SuggestionsBody
  const result = await generateSuggestions(request.user.sub, body)
  return reply.send(result)
}

export async function patchSpot(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as SpotParam
  const body = request.body as UpdateSpotBody
  const spot = await editSpot(id, request.user.sub, body)
  return reply.send(spot)
}

export async function deleteSpot(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as SpotParam
  await cancelSpot(id, request.user.sub)
  return reply.status(204).send()
}
