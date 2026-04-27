import { checkEventAccess } from '../event-invites/event-invites.access'
import {
  createEvent,
  deleteEvent,
  findEventAccess,
  findEventById,
  findEventsByAuthor,
  findPublicEvents,
  updateEvent,
} from './events.repository'
import type {
  CreateEventBody,
  ListEventsQuery,
  UpdateEventBody,
} from './events.schema'

export async function listEvents(query: ListEventsQuery, viewerId?: string) {
  const { category, dateFrom, dateTo, limit, cursor } = query
  const events = await findPublicEvents(
    { category, dateFrom, dateTo },
    limit,
    cursor,
    viewerId,
  )
  const nextCursor =
    events.length === limit ? (events[events.length - 1].id as string) : null
  return { data: events, nextCursor }
}

export async function listUserEvents(
  authorId: string,
  limit: number,
  viewerId?: string,
  cursor?: string,
) {
  const events = await findEventsByAuthor(authorId, limit, viewerId, cursor)
  const nextCursor =
    events.length === limit ? (events[events.length - 1].id as string) : null
  return { data: events, nextCursor }
}

export async function getEventById(id: string, requesterId?: string) {
  const event = await findEventById(id, requesterId)
  if (!event) throw { statusCode: 404, message: 'Evento não encontrado' }
  await checkEventAccess(event as { id: string; isPublic: boolean; authorId: string }, requesterId)
  return event
}

export async function addEvent(data: CreateEventBody, authorId: string) {
  return createEvent({ ...data, authorId })
}

export async function editEvent(
  id: string,
  data: UpdateEventBody,
  requesterId: string,
) {
  const event = await findEventAccess(id)
  if (!event) throw { statusCode: 404, message: 'Evento não encontrado' }
  if (event.authorId !== requesterId)
    throw { statusCode: 403, message: 'Você não tem permissão para realizar esta ação' }
  return updateEvent(id, data)
}

export async function removeEvent(id: string, requesterId: string) {
  const event = await findEventAccess(id)
  if (!event) throw { statusCode: 404, message: 'Evento não encontrado' }
  if (event.authorId !== requesterId)
    throw { statusCode: 403, message: 'Você não tem permissão para realizar esta ação' }
  return deleteEvent(id)
}
