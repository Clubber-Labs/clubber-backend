import { cache } from '../../lib/cache'
import { deleteUploaded, uploadEventImage } from '../../lib/uploads'
import { checkEventAccess } from '../event-invites/event-invites.access'
import {
  createEvent,
  createEventImage,
  deleteEvent,
  findEventAccess,
  findEventById,
  findEventImageKeys,
  findEventsByAuthor,
  findPublicEvents,
  findViewerStatesForEvents,
  type SharedEvent,
  updateEvent,
} from './events.repository'
import type {
  CreateEventBody,
  ListEventsQuery,
  UpdateEventBody,
} from './events.schema'

type Logger = { error: (msg: string) => void }

type SharedListResult = {
  data: SharedEvent[]
  nextCursor: string | null
}

export async function listEvents(query: ListEventsQuery, viewerId?: string) {
  const cacheKey = cache.key(
    'events:public',
    query.category ? [...query.category].sort().join(',') : undefined,
    query.dateFrom?.toISOString(),
    query.dateTo?.toISOString(),
    query.limit,
    query.cursor,
  )

  let shared = await cache.get<SharedListResult>(cacheKey)
  if (!shared) {
    const events = await findPublicEvents(
      {
        category: query.category,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
      },
      query.limit,
      query.cursor,
    )
    const nextCursor =
      events.length === query.limit ? events[events.length - 1].id : null
    shared = { data: events, nextCursor }
    await cache.set(cacheKey, shared, 300)
  }

  return mergeViewerState(shared, viewerId)
}

async function mergeViewerState(shared: SharedListResult, viewerId?: string) {
  if (!viewerId) {
    return {
      ...shared,
      data: shared.data.map((e) => ({
        ...e,
        userReaction: null,
        userAttendance: null,
      })),
    }
  }

  const states = await findViewerStatesForEvents(
    viewerId,
    shared.data.map((e) => e.id),
  )
  return {
    ...shared,
    data: shared.data.map((e) => {
      const state = states.get(e.id)
      return {
        ...e,
        userReaction: state?.reaction ?? null,
        userAttendance: state?.attendance ?? null,
      }
    }),
  }
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
  await checkEventAccess(
    event as { id: string; isPublic: boolean; authorId: string },
    requesterId,
  )
  return event
}

export async function addEvent(data: CreateEventBody, authorId: string) {
  const event = await createEvent({ ...data, authorId })
  if (data.isPublic === true) {
    await cache.invalidate('events:public:*')
  }
  return event
}

export async function editEvent(
  id: string,
  data: UpdateEventBody,
  requesterId: string,
) {
  const event = await findEventAccess(id)
  if (!event) throw { statusCode: 404, message: 'Evento não encontrado' }
  if (event.authorId !== requesterId)
    throw {
      statusCode: 403,
      message: 'Você não tem permissão para realizar esta ação',
    }

  const updated = await updateEvent(id, data)
  if (event.isPublic || data.isPublic === true) {
    await cache.invalidate('events:public:*')
  }
  return updated
}

export async function removeEvent(
  id: string,
  requesterId: string,
  logger: Logger,
) {
  const event = await findEventAccess(id)
  if (!event) throw { statusCode: 404, message: 'Evento não encontrado' }
  if (event.authorId !== requesterId)
    throw {
      statusCode: 403,
      message: 'Você não tem permissão para realizar esta ação',
    }

  const images = (await findEventImageKeys(id)) as { key: string }[]
  await Promise.all(images.map((img) => deleteUploaded(img.key, logger)))
  await deleteEvent(id)
  if (event.isPublic) {
    await cache.invalidate('events:public:*')
  }
}

export async function addEventImage(
  id: string,
  buffer: Buffer,
  requesterId: string,
  logger: Logger,
) {
  const event = await findEventAccess(id)
  if (!event) throw { statusCode: 404, message: 'Evento não encontrado' }
  if (event.authorId !== requesterId)
    throw {
      statusCode: 403,
      message: 'Você não tem permissão para realizar esta ação',
    }

  const uploaded = await uploadEventImage(buffer, id)

  try {
    const image = await createEventImage(id, {
      url: uploaded.url,
      key: uploaded.key,
      format: uploaded.format,
      size: uploaded.size,
    })
    if (event.isPublic) {
      await cache.invalidate('events:public:*')
    }
    return image
  } catch (err) {
    await deleteUploaded(uploaded.key, logger)
    throw err
  }
}
