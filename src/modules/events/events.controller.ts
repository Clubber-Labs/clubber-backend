import type { FastifyReply, FastifyRequest } from 'fastify'
import type {
  CreateEventBody,
  EventParams,
  ListEventsQuery,
  UpdateEventBody,
  UserEventsParams,
  UserEventsQuery,
} from './events.schema'
import {
  addEvent,
  editEvent,
  getEventById,
  listEvents,
  listUserEvents,
  removeEvent,
} from './events.service'

function getEventsResponseData<T>(result: T | { data: T; nextCursor?: string | null }): T {
  if (
    result !== null &&
    typeof result === 'object' &&
    'data' in result
  ) {
    return result.data
  }
  return result
}
export async function getEvents(request: FastifyRequest, reply: FastifyReply) {
  const query = request.query as ListEventsQuery
  const events = await listEvents(query)
  return reply.send(getEventsResponseData(events))
}

export async function getEvent(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as EventParams
  const event = await getEventById(id, request.user?.sub)
  return reply.send(event)
}

export async function getUserEvents(request: FastifyRequest, reply: FastifyReply) {
  const { userId } = request.params as UserEventsParams
  const { limit, cursor } = request.query as UserEventsQuery
  const viewerId = (request.user as { sub: string } | undefined)?.sub
  const result = await listUserEvents(userId, limit, viewerId, cursor)
  return reply.send(result)
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
