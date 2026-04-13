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

export async function getEvent(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as EventParams
  const event = await getEventById(id, request.user.sub)
  return reply.send(event)
}

export async function postEvent(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as CreateEventBody
  const event = await addEvent(body, request.user.sub)
  return reply.status(201).send(event)
}

export async function putEvent(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as EventParams
  const body = request.body as UpdateEventBody
  const event = await editEvent(id, body, request.user.sub)
  return reply.send(event)
}

export async function deleteEventHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as EventParams
  await removeEvent(id, request.user.sub)
  return reply.status(204).send()
}
