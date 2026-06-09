import { cache } from '../../lib/cache'
import { snapToGrid } from '../../lib/spatial'
import { deleteUploaded, uploadEventImage } from '../../lib/uploads'
import { checkEventAccess } from '../event-invites/event-invites.access'
import { findAcceptedFollowingIds } from '../follows/follows.repository'
import {
  createEvent,
  createEventImage,
  deleteEvent,
  findEventAccess,
  findEventById,
  findEventImageKeys,
  findEventsByAuthor,
  findEventsForMap,
  findEventsInViewport,
  findPublicEvents,
  findPublicEventsByDistance,
  findPublicEventsByPopularity,
  findTopAttendancesByEvent,
  findViewerStatesForEvents,
  type NormalizedEvent,
  type SharedEvent,
  searchEvents,
  updateEvent,
} from './events.repository'
import type {
  CreateEventBody,
  ListEventsQuery,
  MapEventsQuery,
  UpdateEventBody,
  ViewportQuery,
} from './events.schema'

type Logger = {
  trace: (obj: object | string, msg?: string) => void
  debug: (obj: object | string, msg?: string) => void
  info: (obj: object | string, msg?: string) => void
  warn: (obj: object | string, msg?: string) => void
  error: (obj: object | string, msg?: string) => void
}

type SharedListResult = {
  data: SharedEvent[]
  nextCursor: string | null
}

type NormalizedListResult = {
  data: NormalizedEvent[]
  nextCursor: string | null
}

/**
 * Lista pública de eventos. Cache shared (sem viewer state na key, só o set
 * que depende de visibilidade) hidratado com viewer state depois — atende
 * RNF05.2 (hit rate >90%) sem perder personalização de userLiked/attendance.
 *
 * Proximidade (orderBy=distance e/ou radiusKm) deixou de fazer bypass: as
 * coordenadas são "snapadas" a uma grade (~110m) antes de montar a chave e a
 * query, então vizinhos compartilham a mesma entrada. O snap afeta ordenação
 * e chave; no radiusKm vale tolerância de borda ~156m (ver snapToGrid).
 */
export async function listEvents(query: ListEventsQuery, viewerId?: string) {
  const snapped =
    query.nearLat !== undefined && query.nearLng !== undefined
      ? snapToGrid(query.nearLat, query.nearLng)
      : undefined
  // Só o CENTRO é snapado (tolerância de borda ~156m, ver snapToGrid). O
  // radiusKm fica EXATO no filtro e na chave: bucketizar o raio expandiria a
  // busca em km (não ~156m) e colidiria raios distintos na mesma entrada.
  const effectiveQuery: ListEventsQuery = snapped
    ? { ...query, nearLat: snapped.lat, nearLng: snapped.lng }
    : query

  // viewerId entra na chave porque a visibilidade de autor é filtrada no SQL
  // (perfis privados só aparecem pra followers). orderBy + centro snapado +
  // radiusKm EXATO também entram — sem eles, células/raios distintos colidiriam.
  const cacheKey = cache.key(
    'events:public',
    viewerId ?? 'anon',
    query.category ? [...query.category].sort().join(',') : '',
    query.status ? [...query.status].sort().join(',') : '',
    query.includePast ? '1' : '0',
    query.dateFrom?.toISOString() ?? '',
    query.dateTo?.toISOString() ?? '',
    query.orderBy,
    snapped ? `${snapped.lat},${snapped.lng}` : '',
    query.radiusKm ?? '',
    query.limit,
    query.cursor ?? '',
  )

  let shared = await cache.get<SharedListResult>(cacheKey)
  // Guarda de shape: entrada corrompida ou de versão antiga não pode virar
  // TypeError no mergeViewerState — trata como miss e recomputa.
  if (shared && !Array.isArray(shared.data)) {
    shared = null
  }
  if (!shared) {
    if (effectiveQuery.orderBy === 'distance') {
      const { events, nextCursor } = await findPublicEventsByDistance(
        effectiveQuery,
        effectiveQuery.limit,
        effectiveQuery.cursor,
        viewerId,
      )
      shared = { data: events, nextCursor }
    } else if (effectiveQuery.orderBy === 'popularity') {
      const { events, nextCursor } = await findPublicEventsByPopularity(
        effectiveQuery,
        effectiveQuery.limit,
        effectiveQuery.cursor,
        viewerId,
      )
      shared = { data: events, nextCursor }
    } else {
      const { events, nextCursor } = await findPublicEvents(
        effectiveQuery,
        effectiveQuery.limit,
        effectiveQuery.cursor,
        viewerId,
      )
      shared = { data: events, nextCursor }
    }
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

function assertCanFilterByFriends(friendsOnly: boolean, viewerId?: string) {
  if (friendsOnly && !viewerId) {
    throw {
      statusCode: 401,
      message: 'Autenticação necessária para filtrar por amigos',
    }
  }
}

export async function listEventsForMap(
  query: MapEventsQuery,
  viewerId?: string,
) {
  assertCanFilterByFriends(query.friendsOnly, viewerId)
  const followingIds =
    query.friendsOnly && viewerId
      ? await findAcceptedFollowingIds(viewerId)
      : []
  return findEventsForMap(query, viewerId, followingIds)
}

/**
 * Viewport: FeedEvent completos no bbox + friendAttendances (top N por
 * prioridade/recência) + estado do viewer. Sem cache (depende do bbox e do
 * viewer). Retorna { data, truncated }.
 */
export async function listEventsForViewport(
  query: ViewportQuery,
  viewerId?: string,
) {
  assertCanFilterByFriends(query.friendsOnly, viewerId)
  const followingIds = viewerId ? await findAcceptedFollowingIds(viewerId) : []
  const { events, truncated } = await findEventsInViewport(
    query,
    viewerId,
    followingIds,
  )
  if (events.length === 0) return { data: [], truncated }

  const eventIds = events.map((e) => e.id)
  const commentIds = events.flatMap((e) => e.recentComments.map((c) => c.id))
  const [topMap, states] = await Promise.all([
    findTopAttendancesByEvent(eventIds, followingIds),
    viewerId
      ? findViewerStatesForEvents(viewerId, eventIds, commentIds)
      : Promise.resolve(null),
  ])

  const data = events.map((e) => {
    const normalized = states
      ? hydrateWithState(e, states.get(e.id))
      : hydrateAnon(e)
    const top = topMap.get(e.id) ?? []
    return {
      ...normalized,
      // Subconjunto de amigos do topAttendances — NÃO é a lista completa de
      // amigos presentes: é o top-5 de amigos (amigos vêm primeiro no ranking,
      // então cabem antes do limite). Para avatares no pin; total via _count.
      friendAttendances: top
        .filter((a) => a.isFriend)
        .map((a) => ({ user: a.user })),
      topAttendances: top.map((a) => ({ user: a.user })),
    }
  })
  return { data, truncated }
}

/**
 * Busca textual global por título/descrição/endereço, paginada por cursor.
 * Hidrata o estado do viewer (userLiked/userAttendance) na lista resultante.
 */
export async function searchEventsService(
  q: string,
  limit: number,
  cursor: string | undefined,
  viewerId?: string,
) {
  const events = await searchEvents(q, limit, cursor, viewerId)
  const nextCursor =
    events.length === limit ? events[events.length - 1].id : null
  const shared: SharedListResult = { data: events, nextCursor }
  return mergeViewerState(shared, viewerId)
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
