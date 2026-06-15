import { cache } from '../../lib/cache'
import { deleteUploaded, uploadEventImage } from '../../lib/uploads'
import { checkEventAccess } from '../event-invites/event-invites.access'
import { findAcceptedFollowingIds } from '../follows/follows.repository'
import { enqueueEventCreated } from '../notifications/notification-queue'
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

  // Chave viewer-agnóstica: no modelo híbrido a lista pública é idêntica para
  // todos (só `isPublic` + lifecycle + filtros, sem gate de autor por viewer),
  // então o cache shared é compartilhado entre viewers. O estado do viewer
  // (userLiked, userAttendance) é hidratado depois em mergeViewerState —
  // restaura o hit-rate alto do RNF05.2 sem vazar nada entre usuários.
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
  return findEventsForMap(query, followingIds)
}

// Cache do viewport. Só cacheamos a parte SHARED (eventos no tile, sem nada do
// viewer) — o estado do viewer e o ranking de amigos são hidratados por cima a
// cada request, como em listEvents. friendsOnly não é cacheável (depende da
// rede do viewer).
const VIEWPORT_CACHE_TTL_SECONDS = 20
// Passo da grade que "encaixa" o bbox num tile canônico (~0.05° ≈ 5,5 km).
// Pans/zooms pequenos caem no mesmo tile → alto hit-rate sob carga. O tile
// CONTÉM o bbox pedido (floor/ceil), então a resposta é superconjunto da área
// visível: nenhum evento do viewport fica de fora.
const VIEWPORT_TILE_DEG = 0.05

type SharedViewport = { events: SharedEvent[]; truncated: boolean }

// Índices inteiros do tile (estáveis, sem ruído de float na chave de cache).
function tileIndices(query: ViewportQuery) {
  const step = VIEWPORT_TILE_DEG
  return {
    n: Math.ceil(query.bboxNorth / step),
    s: Math.floor(query.bboxSouth / step),
    e: Math.ceil(query.bboxEast / step),
    w: Math.floor(query.bboxWest / step),
  }
}

async function getSharedViewport(
  query: ViewportQuery,
  followingIds: string[],
): Promise<SharedViewport> {
  // friendsOnly depende do viewer → sem cache (e a query precisa dos ids).
  if (query.friendsOnly) return findEventsInViewport(query, followingIds)

  const t = tileIndices(query)
  const step = VIEWPORT_TILE_DEG
  const tileQuery: ViewportQuery = {
    ...query,
    bboxNorth: t.n * step,
    bboxSouth: t.s * step,
    bboxEast: t.e * step,
    bboxWest: t.w * step,
  }
  const cacheKey = cache.key(
    'events:viewport',
    t.n,
    t.s,
    t.e,
    t.w,
    query.limit,
    query.category ? [...query.category].sort().join(',') : '',
    query.status ? [...query.status].sort().join(',') : '',
  )

  const cached = await cache.get<SharedViewport>(cacheKey)
  if (cached) return cached

  // followingIds não é usado quando !friendsOnly (a query é viewer-agnóstica).
  const result = await findEventsInViewport(tileQuery, [])
  await cache.set(cacheKey, result, VIEWPORT_CACHE_TTL_SECONDS)
  return result
}

/**
 * Viewport: eventos do mapa no bbox + friendAttendances (top N por
 * prioridade/recência) + estado do viewer. A parte shared é cacheada por tile
 * (getSharedViewport); o viewer state é hidratado por cima. Retorna
 * { data, truncated }.
 */
export async function listEventsForViewport(
  query: ViewportQuery,
  viewerId?: string,
) {
  assertCanFilterByFriends(query.friendsOnly, viewerId)
  const followingIds = viewerId ? await findAcceptedFollowingIds(viewerId) : []
  const { events, truncated } = await getSharedViewport(query, followingIds)
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
  const events = await searchEvents(q, limit, cursor)
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

  // Participantes em destaque (amigos primeiro) para a prova social "quem vai"
  // no detalhe — mesma fonte do mapa e do feed.
  const commentIds = event.recentComments.map((c) => c.id)
  // followingIds e viewerStates só dependem do requesterId (não um do outro):
  // vão juntos. topAttendances depende de followingIds, então fecha o caminho.
  const [followingIds, states] = await Promise.all([
    requesterId ? findAcceptedFollowingIds(requesterId) : Promise.resolve([]),
    requesterId
      ? findViewerStatesForEvents(requesterId, [event.id], commentIds)
      : Promise.resolve(null),
  ])
  const topMap = await findTopAttendancesByEvent([event.id], followingIds)
  // friendAttendances é o subconjunto de amigos do topAttendances (mesma fonte,
  // sem segunda query) — alinhado com viewport e feed.
  const top = topMap.get(event.id) ?? []
  const topAttendances = top.map((a) => ({ user: a.user }))
  const friendAttendances = top
    .filter((a) => a.isFriend)
    .map((a) => ({ user: a.user }))

  const normalized = states
    ? hydrateWithState(event, states.get(event.id))
    : hydrateAnon(event)
  return { ...normalized, topAttendances, friendAttendances }
}

// Invalida os caches de leitura de eventos (lista pública + viewport do mapa).
// Chamado em toda escrita que afeta descoberta — garante que privar/cancelar
// um evento o remova IMEDIATAMENTE do mapa (o TTL só defasaria contagem/status).
async function invalidateEventCaches(): Promise<void> {
  await Promise.all([
    cache.invalidate('events:public:*'),
    cache.invalidate('events:viewport:*'),
  ])
}

export async function addEvent(data: CreateEventBody, authorId: string) {
  const event = await createEvent({ ...data, authorId })
  if (data.isPublic === true) {
    await invalidateEventCaches()
    // Fan-out de proximidade (best-effort, pós-commit): só eventos públicos.
    await enqueueEventCreated(event.id)
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
    await invalidateEventCaches()
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
    await invalidateEventCaches()
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
      await invalidateEventCaches()
    }
    return image
  } catch (err) {
    await deleteUploaded(uploaded.key, logger)
    throw err
  }
}
