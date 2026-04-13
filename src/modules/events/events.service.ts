import {
  createEvent,
  deleteEvent,
  findAllPublicEvents,
  findEventById,
  updateEvent,
} from './events.repository'
import type { CreateEventBody, UpdateEventBody } from './events.schema'

export async function listPublicEvents() {
  return findAllPublicEvents()
}

export async function getEventById(id: string) {
  const event = await findEventById(id)
  if (!event) {
    throw { statusCode: 404, message: 'Event not found' }
  }
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
  const event = await findEventById(id)
  if (!event) {
    throw { statusCode: 404, message: 'Event not found' }
  }
  if (event.authorId !== requesterId) {
    throw { statusCode: 403, message: 'Forbidden' }
  }
  return updateEvent(id, data)
}

export async function removeEvent(id: string, requesterId: string) {
  const event = await findEventById(id)
  if (!event) {
    throw { statusCode: 404, message: 'Event not found' }
  }
  if (event.authorId !== requesterId) {
    throw { statusCode: 403, message: 'Forbidden' }
  }
  return deleteEvent(id)
}
