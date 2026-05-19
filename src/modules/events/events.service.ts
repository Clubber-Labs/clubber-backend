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
  findEventsForMap,
  findPublicEvents,
  findViewerStatesForEvents,
  type NormalizedEvent,
  type SharedEvent,
  updateEvent,
} from './events.repository'
import type {
  CreateEventBody,
  ListEventsQuery,
  MapEventsQuery,
  UpdateEventBody,
} from './events.schema'

type Logger = { error: (msg: string) => void }

type SharedListResult = {
  data: SharedEvent[]
  nextCursor: string | null
}

type NormalizedListResult = {
  data: NormalizedEvent[]
  nextCursor: string | null
}

/**
 * Lista pública de eventos. Cache shared (sem viewerId na key) é hidratado
 * com viewer state depois — atende RNF05.2 (hit rate >90%) sem perder
 * personalização de userLiked/userAttendance.
 *
 * orderBy=distance faz bypass do cache porque depende de lat/lng do
 * request específico — caching teria hit-rate praticamente zero.
 */
export async function listEvents(query: ListEventsQuery, viewerId?: string) {
  if (query.orderBy === 'distance') {
    const events = await findPublicEvents(query, query.limit, query.cursor)
    const nextCursor = null // ordenação por distância não usa cursor pagination
    const shared = { data: events, nextCursor }
    return mergeViewerState(shared, viewerId)
  }

  const cacheKey = cache.key(
    'events:public',
    query.category ? [...query.category].sort().join(',') : '',
    query.status ? [...query.status].sort().join(',') : '',
    query.includePast ? '1' : '0',
    query.dateFrom?.toISOString() ?? '',
    query.dateTo?.toISOString() ?? '',
    query.limit,
    query.cursor ?? '',
  )

  let shared = await cache.get<SharedListResult>(cacheKey)
  if (!shared) {
    const events = await findPublicEvents(query, query.limit, query.cursor)
    const nextCursor =
      events.length === query.limit ? events[events.length - 1].id : null
    shared = { data: events, nextCursor }
    await cache.set(cacheKey, shared, 60)
  }

  return mergeViewerState(shared, viewerId)
}

async function mergeViewerState(
  shared: SharedListResult,
  viewerId?: string,
): Promise<NormalizedListResult> {
  if (!viewerId || shared.data.length === 0) {
    return {
      ...shared,
      data: shared.data.map((e) => hydrateAnon(e)),
    }
  }

  const eventIds = shared.data.map((e) => e.id)
  const commentIds = shared.data.flatMap((e) =>
    e.recentComments.map((c) => c.id),
  )
  const states = await findViewerStatesForEvents(viewerId, eventIds, commentIds)

  return {
    ...shared,
    data: shared.data.map((e) => {
      const state = states.get(e.id)
      return hydrateWithState(e, state)
    }),
  }
}

function hydrateAnon(e: SharedEvent): NormalizedEvent {
  return {
    ...e,
    recentComments: e.recentComments.map((c) => ({ ...c, userLiked: false })),
    userLiked: false,
    userAttendance: null,
  }
}

function hydrateWithState(
  e: SharedEvent,
  state:
    | { liked: boolean; attendance: string | null; commentsLiked: Set<string> }
    | undefined,
): NormalizedEvent {
  return {
    ...e,
    recentComments: e.recentComments.map((c) => ({
      ...c,
      userLiked: state ? state.commentsLiked.has(c.id) : false,
    })),
    userLiked: state?.liked ?? false,
    userAttendance: state?.attendance ?? null,
  }
}

export async function listEventsForMap(query: MapEventsQuery) {
  return findEventsForMap(query)
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
  const shared: SharedListResult = { data: events, nextCursor }
  return mergeViewerState(shared, viewerId)
}

export async function getEventById(id: string, requesterId?: string) {
  const event = await findEventById(id)
  if (!event) throw { statusCode: 404, message: 'Evento não encontrado' }
  await checkEventAccess(
    event as { id: string; isPublic: boolean; authorId: string },
    requesterId,
  )

  if (!requesterId) return hydrateAnon(event)

  const commentIds = event.recentComments.map((c) => c.id)
  const states = await findViewerStatesForEvents(
    requesterId,
    [event.id],
    commentIds,
  )
  return hydrateWithState(event, states.get(event.id))
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

  const effectiveDate = data.date ?? event.date
  const effectiveEndDate =
    data.endDate === undefined ? event.endDate : data.endDate
  if (effectiveEndDate && effectiveEndDate <= effectiveDate) {
    throw { statusCode: 400, message: 'endDate deve ser depois de date' }
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
