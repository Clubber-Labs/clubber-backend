import type { FastifyReply, FastifyRequest } from 'fastify'
import type {
  CreateEventBody,
  EventParams,
  UpdateEventBody,
} from './events.schema'
import {
  addEvent,
  editEvent,
  getEventById,
  listPublicEvents,
  removeEvent,
} from './events.service'

export async function getEvents(_request: FastifyRequest, reply: FastifyReply) {
  const events = await listPublicEvents()
  return reply.send(events)
}

export async function getEvent(
  request: FastifyRequest<{ Params: EventParams }>,
  reply: FastifyReply,
) {
  const event = await getEventById(request.params.id)
  return reply.send(event)
}

export async function postEvent(
  request: FastifyRequest<{ Body: CreateEventBody }>,
  reply: FastifyReply,
) {
  const event = await addEvent(request.body, request.user.sub)
  return reply.status(201).send(event)
}

export async function putEvent(
  request: FastifyRequest<{ Params: EventParams; Body: UpdateEventBody }>,
  reply: FastifyReply,
) {
  const event = await editEvent(
    request.params.id,
    request.body,
    request.user.sub,
  )
  return reply.send(event)
}

export async function deleteEventHandler(
  request: FastifyRequest<{ Params: EventParams }>,
  reply: FastifyReply,
) {
  await removeEvent(request.params.id, request.user.sub)
  return reply.status(204).send()
}
