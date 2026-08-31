import { cache } from '../../lib/cache'
import { AppError } from '../../lib/errors/app-error'
import { timezoneForLocation } from '../../lib/i18n/timezone'
import { findVisibleProfileOwner } from '../../lib/profile-visibility'
import { interestMatchesCategories } from '../../lib/subcategories'
import {
  deleteUploaded,
  MAX_GALLERY_IMAGES,
  uploadEventImage,
} from '../../lib/uploads'
import { checkEventAccess } from '../event-invites/event-invites.access'
import { findAcceptedFollowingIds } from '../follows/follows.repository'
import { enqueueEventCreated } from '../notifications/notification-queue'
import { createRecurringEvent } from '../recurring-events/recurring-events.service'
import {
  countEventImages,
  countProfileEvents,
  createEvent,
  createEventImage,
  deleteEvent,
  deleteEventImage,
  findEventAccess,
  findEventById,
  findEventImage,
  findEventImageIds,
  findEventImageKeys,
  findEventsForMap,
  findEventsInViewport,
  findProfileEvents,
  findPublicEvents,
  findTopAttendancesByEvent,
  findViewerStatesForEvents,
  type NormalizedEvent,
  reorderEventImages,
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
    throw new AppError(401, 'AUTH_REQUIRED')
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
  // Portão do DONO do perfil. Enquanto a vitrine era só o que ele criou, o
  // filtro por autor já fazia isso sozinho; com as presenças, o autor do evento
  // é outra pessoa e a privacidade dele precisa ser checada aqui.
  const owner = await findVisibleProfileOwner(authorId, viewerId)
  if (!owner) return { data: [], nextCursor: null, total: 0 }

  const scope = {
    ownerId: authorId,
    viewerId,
    // Confirmação de presença é atividade social: quem desligou "visibilidade
    // das suas atividades" some da vitrine dos outros, mas continua vendo a
    // própria.
    includeAttended: viewerId === authorId || owner.socialVisibility,
  }
  // `total` é o número do cabeçalho da vitrine, e não o de eventos criados
  // (esse é o `eventsCount` do perfil, que continua sendo de autoria). Só na 1ª
  // página: não muda entre páginas, e é a parte cara da listagem.
  const [events, total] = await Promise.all([
    findProfileEvents({ ...scope, limit, cursor }),
    cursor ? Promise.resolve(undefined) : countProfileEvents(scope),
  ])
  const nextCursor =
    events.length === limit ? (events[events.length - 1].id as string) : null
  const shared: SharedListResult = { data: events, nextCursor }
  const page = await mergeViewerState(shared, viewerId)
  return total === undefined ? page : { ...page, total }
}

export async function getEventById(id: string, requesterId?: string) {
  const event = await findEventById(id)
  if (!event) throw new AppError(404, 'EVENT_NOT_FOUND')
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
  const { recurrence, ...eventData } = data
  // RF11.6: com bloco recurrence, delega para a criação de série (gate premium
  // no service). Sem recurrence, o evento avulso segue sem exigir premium.
  if (recurrence) {
    return createRecurringEvent(eventData, recurrence, authorId)
  }

  const event = await createEvent({
    ...eventData,
    authorId,
    timezone: timezoneForLocation(eventData.latitude, eventData.longitude),
  })
  if (eventData.isPublic === true) {
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
  if (!event) throw new AppError(404, 'EVENT_NOT_FOUND')
  if (event.authorId !== requesterId) throw new AppError(403, 'FORBIDDEN')

  const effectiveDate = data.date ?? event.date
  const effectiveEndDate =
    data.endDate === undefined ? event.endDate : data.endDate
  if (effectiveEndDate && effectiveEndDate <= effectiveDate) {
    throw new AppError(400, 'END_DATE_BEFORE_START')
  }

  // Coerência das tags contra o estado EFETIVO: mexer em categories e/ou
  // subcategories não pode deixar uma subcategoria órfã (sem categoria-pai).
  // Encolher categories sem limpar a subcategoria correspondente também cai aqui.
  if (data.categories !== undefined || data.subcategories !== undefined) {
    const effectiveCategories = data.categories ?? event.categories
    const effectiveSubcategories = data.subcategories ?? event.subcategories
    for (const key of effectiveSubcategories) {
      if (!interestMatchesCategories(key, effectiveCategories)) {
        throw new AppError(400, 'SUBCATEGORY_INCOHERENT', undefined, { key })
      }
    }
  }

  // Mudou de lugar, muda de fuso: sem isto o evento carregado para outra cidade
  // continuaria formatando a hora no fuso antigo.
  const moved = data.latitude !== undefined || data.longitude !== undefined
  const timezone = moved
    ? timezoneForLocation(
        data.latitude ?? event.latitude,
        data.longitude ?? event.longitude,
      )
    : undefined

  const updated = await updateEvent(id, {
    ...data,
    ...(timezone && { timezone }),
  })
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
  if (!event) throw new AppError(404, 'EVENT_NOT_FOUND')
  if (event.authorId !== requesterId) throw new AppError(403, 'FORBIDDEN')

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
  if (!event) throw new AppError(404, 'EVENT_NOT_FOUND')
  if (event.authorId !== requesterId) throw new AppError(403, 'FORBIDDEN')

  // Antes do upload: barrar depois já teria pago o processamento e deixado o
  // blob no provider para o rollback limpar.
  const current = await countEventImages(id)
  if (current >= MAX_GALLERY_IMAGES) {
    throw new AppError(409, 'EVENT_IMAGE_LIMIT', undefined, {
      max: MAX_GALLERY_IMAGES,
    })
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

export async function removeEventImage(
  id: string,
  imageId: string,
  requesterId: string,
  logger: Logger,
) {
  const event = await findEventAccess(id)
  if (!event) throw new AppError(404, 'EVENT_NOT_FOUND')
  if (event.authorId !== requesterId) throw new AppError(403, 'FORBIDDEN')

  const image = await findEventImage(id, imageId)
  if (!image) throw new AppError(404, 'EVENT_IMAGE_NOT_FOUND')

  await deleteEventImage(imageId)
  await deleteUploaded(image.key, logger)
  if (event.isPublic) {
    await invalidateEventCaches()
  }
}

export async function reorderEventImagesService(
  id: string,
  order: string[],
  requesterId: string,
) {
  const event = await findEventAccess(id)
  if (!event) throw new AppError(404, 'EVENT_NOT_FOUND')
  if (event.authorId !== requesterId) throw new AppError(403, 'FORBIDDEN')

  // A lista tem que ser um rearranjo exato do conjunto atual: id repetido,
  // faltando ou de outro evento deixaria imagem sem posição definida — ou
  // reposicionaria a imagem de um evento alheio.
  const current = await findEventImageIds(id)
  const requested = new Set(order)
  if (
    requested.size !== order.length ||
    requested.size !== current.length ||
    !current.every((imageId) => requested.has(imageId))
  ) {
    throw new AppError(400, 'IMAGE_ORDER_MISMATCH')
  }

  const images = await reorderEventImages(id, order)
  if (event.isPublic) {
    await invalidateEventCaches()
  }
  return images
}
