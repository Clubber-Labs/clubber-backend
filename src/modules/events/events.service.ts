import { imageProcessorService } from '../../lib/image-processor'
import { storageService } from '../../lib/storage'
import { ensureEventAccess } from '../event-invites/event-invites.access'
import {
  createEvent,
  createEventImage,
  deleteEvent,
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

export async function listEvents(query: ListEventsQuery) {
  const { category, dateFrom, dateTo, limit, cursor } = query
  const events = await findPublicEvents(
    { category, dateFrom, dateTo },
    limit,
    cursor,
  )
  const nextCursor =
    events.length === limit ? events[events.length - 1].id : null
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
    events.length === limit ? events[events.length - 1].id : null
  return { data: events, nextCursor }
}

export async function getEventById(id: string, requesterId?: string) {
  return ensureEventAccess(id, requesterId)
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

export async function addEventImage(
  id: string,
  fileBuffer: Buffer,
  filename: string,
  requesterId: string,
) {
  const event = await findEventById(id)
  if (!event) {
    throw { statusCode: 404, message: 'Event not found' }
  }
  if (event.authorId !== requesterId) {
    throw { statusCode: 403, message: 'Forbidden' }
  }

  const processed = await imageProcessorService.processEventGallery(fileBuffer)

  const uploadResult = await storageService.upload(
    {
      buffer: processed.buffer,
      filename,
      mimetype: 'image/webp',
    },
    `events/${id}`,
  )

  try {
    return await createEventImage({
      url: uploadResult.url,
      key: uploadResult.key,
      format: processed.format,
      size: processed.size,
      event: { connect: { id } },
    })
  } catch (err) {
    // Rollback: remove a imagem órfã do storage
    await storageService.delete(uploadResult.key)
    throw err
  }
}
