import type { FastifyReply, FastifyRequest } from 'fastify'
import { assertImageMimetype } from '../../lib/uploads'
import type {
  CreateEventBody,
  EventParams,
  ListEventsQuery,
  MapEventsQuery,
  SearchEventsQuery,
  UpdateEventBody,
  UserEventsParams,
  UserEventsQuery,
  ViewportQuery,
} from './events.schema'
import {
  addEvent,
  addEventImage,
  editEvent,
  getEventById,
  listEvents,
  listEventsForMap,
  listEventsForViewport,
  listUserEvents,
  removeEvent,
  searchEventsService,
} from './events.service'

export async function getEvents(request: FastifyRequest, reply: FastifyReply) {
  const query = request.query as ListEventsQuery
  const viewerId = (request.user as { sub: string } | undefined)?.sub
  const result = await listEvents(query, viewerId)
  request.log.info({ userId: viewerId, requestQuery: query }, 'User requested events with filters')
  return reply.send(result)
}

export async function getEventsMap(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const query = request.query as MapEventsQuery
  const points = await listEventsForMap(query, request.user?.sub)
  request.log.info({ userId: request.user?.sub, requestQuery: query }, 'User requested events for map')
  return reply.send(points)
}

export async function getEventsViewport(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const query = request.query as ViewportQuery
  const result = await listEventsForViewport(query, request.user?.sub)
  return reply.send(result)
}

export async function getEventsSearch(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { q, limit, cursor } = request.query as SearchEventsQuery
  const result = await searchEventsService(q, limit, cursor, request.user?.sub)
  return reply.send(result)
}

export async function getEvent(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as EventParams
  const event = await getEventById(id, request.user?.sub)
  request.log.info({ userId: request.user?.sub, eventId: id }, 'User requested event')
  return reply.send(event)
}

export async function getUserEvents(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { userId } = request.params as UserEventsParams
  const { limit, cursor } = request.query as UserEventsQuery
  const viewerId = (request.user as { sub: string } | undefined)?.sub
  const result = await listUserEvents(userId, limit, viewerId, cursor)
  request.log.info({ userId: viewerId, targetUserId: userId, limit, cursor }, 'User requested events for a specific user')
  return reply.send(result)
}

export async function postEvent(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as CreateEventBody
  const event = await addEvent(body, request.user.sub)
  request.log.info({ eventId: event.id, authorId: event.authorId, isPublic: event.isPublic }, 'Event created')
  return reply.status(201).send(event)
}

export async function putEvent(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as EventParams
  const body = request.body as UpdateEventBody
  const event = await editEvent(id, body, request.user.sub)
  request.log.info({ eventId: id, userId: request.user.sub }, 'Event updated')
  return reply.send(event)
}

export async function deleteEventHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as EventParams
  await removeEvent(id, request.user.sub, request.log)
  request.log.info({ userId: request.user.sub, eventId: id }, 'User deleted event')
  return reply.status(204).send()
}

export async function uploadEventImageHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as EventParams
  const data = await request.file()
  if (!data) {
    throw { statusCode: 400, message: 'Nenhuma imagem foi enviada' }
  }
  assertImageMimetype(data.mimetype)

  const buffer = await data.toBuffer()
  const eventImage = await addEventImage(
    id,
    buffer,
    request.user.sub,
    request.log,
  )
  request.log.info({ userId: request.user.sub, eventId: id, imageId: eventImage.id }, 'User uploaded an image for event')
  return reply.status(201).send(eventImage)
}
