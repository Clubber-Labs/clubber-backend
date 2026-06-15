import { type AttendanceType, Prisma } from '@prisma/client'
import { visibleAuthorWhere } from '../../lib/account-visibility'
import {
  buildLifecycleWhere,
  buildMapLifecycleWhere,
} from '../../lib/event-filters'
import {
  computeEventStatus,
  type EventStatus,
  RECENT_PAST_MS,
} from '../../lib/event-lifecycle'
import { prisma } from '../../lib/prisma'
import { authorVisibleWhere } from '../../lib/profile-visibility'
import {
  type Bbox,
  findEventIdsByDistance,
  findEventIdsInBbox,
  findEventIdsWithinRadius,
} from '../../lib/spatial'
import {
  buildCommentInclude,
  commentAuthorSelect,
} from '../comments/comments.repository'
import type {
  CreateEventBody,
  ListEventsQuery,
  MapEventsQuery,
  UpdateEventBody,
  ViewportQuery,
} from './events.schema'

const POSITIVE_ATTENDANCE: AttendanceType[] = ['CONFIRMED', 'INTERESTED']
// Quantos participantes em destaque acompanham cada evento no payload do mapa.
const TOP_ATTENDANCES_LIMIT = 5

const authorSelect = commentAuthorSelect

const eventImageSelect = {
  id: true,
  url: true,
  format: true,
  size: true,
  order: true,
} as const

/**
 * Includes "shared" — sem nada dependente do viewer.
 * O resultado é cacheável em Redis (key sem viewerId) e compartilhado
 * entre todos os viewers que peçam a mesma lista. O viewer state
 * (userLiked, userAttendance, recentComments[i].userLiked) é hidratado
 * em uma camada acima via findViewerStatesForEvents.
 */
function buildSharedIncludes(): Prisma.EventInclude {
  return {
    author: { select: authorSelect },
    _count: {
      select: { attendances: true, reactions: true, comments: true },
    },
    comments: {
      where: { author: visibleAuthorWhere() },
      orderBy: { createdAt: 'desc' },
      take: 2,
      include: buildCommentInclude(),
    },
    images: {
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: eventImageSelect,
    },
  }
}

/**
 * Includes enxutos do mapa: o viewport (GET /events/map/events) só alimenta
 * pins e o card de preview, que usam autor, contadores, a imagem de capa e os
 * avatares de presença. Dropa a relação `comments` (que no shared rende ~3
 * round-trips: comentários + autores + _count) e limita imagens à capa — o
 * detalhe completo vem do GET /events/:id ao abrir o evento. Corta payload e
 * latência sem regredir a UI do mapa. recentComments é normalizado para [].
 */
function buildMapIncludes(): Prisma.EventInclude {
  return {
    author: { select: authorSelect },
    _count: {
      select: { attendances: true, reactions: true, comments: true },
    },
    images: {
      take: 1,
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: eventImageSelect,
    },
  }
}

type PrismaSharedEvent = Prisma.EventGetPayload<{
  include: {
    author: { select: typeof authorSelect }
    _count: { select: { attendances: true; reactions: true; comments: true } }
    comments: {
      include: {
        author: { select: typeof authorSelect }
        _count: { select: { reactions: true } }
      }
    }
    images: { select: typeof eventImageSelect }
  }
}>

type AuthorPayload = Prisma.UserGetPayload<{ select: typeof authorSelect }>

export type SharedComment = {
  id: string
  content: string
  createdAt: Date
  author: AuthorPayload
  reactionsCount: number
}

export type SharedEvent = Omit<PrismaSharedEvent, 'comments'> & {
  recentComments: SharedComment[]
  status: EventStatus
}

export type NormalizedComment = SharedComment & { userLiked: boolean }

export type NormalizedEvent = Omit<SharedEvent, 'recentComments'> & {
  recentComments: NormalizedComment[]
  userLiked: boolean
  userAttendance: string | null
}

function normalizeShared(
  event: PrismaSharedEvent,
  now: Date = new Date(),
): SharedEvent {
  const { comments, ...rest } = event
  return {
    ...rest,
    recentComments: (comments ?? []).map((c) => ({
      id: c.id,
      content: c.content,
      createdAt: c.createdAt,
      author: c.author,
      reactionsCount: c._count.reactions,
    })),
    status: computeEventStatus(event, now),
  }
}

export async function findPublicEvents(
  filters: Pick<
    ListEventsQuery,
    | 'category'
    | 'status'
    | 'includePast'
    | 'dateFrom'
    | 'dateTo'
    | 'nearLat'
    | 'nearLng'
    | 'radiusKm'
    | 'orderBy'
  >,
  limit: number,
  cursor?: string,
  now: Date = new Date(),
): Promise<SharedEvent[]> {
  const KNN_OVERFETCH = 20
  const KNN_OVERFETCH_CAP = 1000

  let spatialIdFilter: string[] | undefined

  if (
    filters.orderBy === 'distance' &&
    filters.nearLat !== undefined &&
    filters.nearLng !== undefined
  ) {
    spatialIdFilter = await findEventIdsByDistance(
      { latitude: filters.nearLat, longitude: filters.nearLng },
      Math.min(limit * KNN_OVERFETCH, KNN_OVERFETCH_CAP),
      filters.radiusKm,
    )
    if (spatialIdFilter.length === 0) return []
  } else if (
    filters.radiusKm !== undefined &&
    filters.nearLat !== undefined &&
    filters.nearLng !== undefined
  ) {
    spatialIdFilter = await findEventIdsWithinRadius(
      { latitude: filters.nearLat, longitude: filters.nearLng },
      filters.radiusKm,
    )
    if (spatialIdFilter.length === 0) return []
  }

  const events = (await prisma.event.findMany({
    where: {
      AND: [
        { isPublic: true },
        { author: visibleAuthorWhere() },
        buildLifecycleWhere({
          includePast: filters.includePast ?? false,
          status: filters.status,
          now,
        }),
        ...(spatialIdFilter ? [{ id: { in: spatialIdFilter } }] : []),
        ...(filters.category && filters.category.length > 0
          ? [{ categories: { hasSome: filters.category } }]
          : []),
        ...(filters.dateFrom || filters.dateTo
          ? [
              {
                date: {
                  ...(filters.dateFrom && { gte: new Date(filters.dateFrom) }),
                  ...(filters.dateTo && { lte: new Date(filters.dateTo) }),
                },
              },
            ]
          : []),
      ],
    },
    take: filters.orderBy === 'distance' ? undefined : limit,
    ...(cursor &&
      filters.orderBy !== 'distance' && { skip: 1, cursor: { id: cursor } }),
    orderBy: [{ isFeatured: 'desc' }, { date: 'asc' }, { id: 'asc' }],
    include: buildSharedIncludes(),
  })) as unknown as PrismaSharedEvent[]

  const ordered =
    filters.orderBy === 'distance' && spatialIdFilter
      ? spatialIdFilter
          .map((id) => events.find((e) => e.id === id))
          .filter((e): e is PrismaSharedEvent => e !== undefined)
          .slice(0, limit)
      : events

  return ordered.map((e) => normalizeShared(e, now))
}

export async function findEventsByAuthor(
  authorId: string,
  limit: number,
  viewerId?: string,
  cursor?: string,
  now: Date = new Date(),
): Promise<SharedEvent[]> {
  const where: Prisma.EventWhereInput = {
    AND: [
      { authorId },
      { author: visibleAuthorWhere() },
      authorVisibleWhere(viewerId),
      ...(viewerId !== authorId ? [{ isPublic: true }] : []),
    ],
  }
  const events = (await prisma.event.findMany({
    where,
    take: limit,
    ...(cursor && { skip: 1, cursor: { id: cursor } }),
    orderBy: [{ isFeatured: 'desc' }, { date: 'asc' }, { id: 'asc' }],
    include: buildSharedIncludes(),
  })) as unknown as PrismaSharedEvent[]

  return events.map((e) => normalizeShared(e, now))
}

export async function findEventAccess(id: string) {
  return prisma.event.findUnique({
    where: { id },
    select: {
      id: true,
      isPublic: true,
      authorId: true,
      date: true,
      endDate: true,
    },
  })
}

/**
 * Campos crus do evento para o fan-out de notificações de proximidade — sem o
 * include pesado nem o filtro de autor visível do findEventById.
 */
export async function findEventForFanout(id: string) {
  return prisma.event.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      latitude: true,
      longitude: true,
      categories: true,
      authorId: true,
      isPublic: true,
      canceledAt: true,
    },
  })
}

export async function findEventById(
  id: string,
  now: Date = new Date(),
): Promise<SharedEvent | null> {
  // findFirst (não findUnique) para combinar id + autor visível: evento de autor
  // desativado/pendente retorna null → o caller responde 404.
  const event = (await prisma.event.findFirst({
    where: { id, author: visibleAuthorWhere() },
    include: buildSharedIncludes(),
  })) as unknown as PrismaSharedEvent | null

  if (!event) return null
  return normalizeShared(event, now)
}

export type ViewerEventState = {
  liked: boolean
  attendance: string | null
  commentsLiked: Set<string>
}

/**
 * Hidratação leve do estado do viewer pra uma lista de eventos já
 * carregada (shared). Duas queries com IN — O(n) onde n = páginas.
 * Tipicamente <15ms mesmo com listas grandes.
 */
export async function findViewerStatesForEvents(
  viewerId: string,
  eventIds: string[],
  commentIds: string[] = [],
): Promise<Map<string, ViewerEventState>> {
  const map = new Map<string, ViewerEventState>(
    eventIds.map((id) => [
      id,
      { liked: false, attendance: null, commentsLiked: new Set() },
    ]),
  )

  if (eventIds.length === 0) return map

  const [reactions, attendances, commentReactions] = await Promise.all([
    prisma.reaction.findMany({
      where: { userId: viewerId, eventId: { in: eventIds } },
      select: { eventId: true },
    }),
    prisma.eventAttendance.findMany({
      where: { userId: viewerId, eventId: { in: eventIds } },
      select: { eventId: true, type: true },
    }),
    commentIds.length > 0
      ? prisma.commentReaction.findMany({
          where: { userId: viewerId, commentId: { in: commentIds } },
          select: { commentId: true },
        })
      : Promise.resolve([]),
  ])

  for (const r of reactions) {
    if (r.eventId) {
      const entry = map.get(r.eventId)
      if (entry) entry.liked = true
    }
  }
  for (const a of attendances) {
    const entry = map.get(a.eventId)
    if (entry) entry.attendance = a.type
  }
  // commentReactions são por comentário, não por evento — agrupa por eventId
  // via lookup reverso (cada commentId pertence a um evento da lista).
  const commentToEvent = new Map<string, string>()
  for (const r of commentReactions) {
    commentToEvent.set(r.commentId, '')
  }
  if (commentReactions.length > 0) {
    const comments = await prisma.comment.findMany({
      where: { id: { in: commentReactions.map((r) => r.commentId) } },
      select: { id: true, eventId: true },
    })
    for (const c of comments) {
      if (c.eventId) commentToEvent.set(c.id, c.eventId)
    }
    for (const r of commentReactions) {
      const eventId = commentToEvent.get(r.commentId)
      if (eventId) {
        const entry = map.get(eventId)
        if (entry) entry.commentsLiked.add(r.commentId)
      }
    }
  }

  return map
}

export type MapEventPoint = {
  id: string
  latitude: number
  longitude: number
  weight: number
}

/**
 * Boost aditivo no peso do heatmap por status do evento.
 * Garante que ONGOING sem confirmados ainda apareça com calor visível,
 * e que SOON tenha leve destaque sobre UPCOMING distante.
 */
const STATUS_HEATMAP_BOOST: Record<EventStatus, number> = {
  ONGOING: 20,
  SOON: 5,
  UPCOMING: 0,
  PAST: 0,
  CANCELED: 0,
}

const MAP_BBOX_FETCH_CAP = 2000
const MAP_RESPONSE_CAP = 500

/**
 * Restringe à rede do viewer: eventos cujo autor é amigo (following aceito) OU
 * que têm presença/interesse de algum amigo. followingIds vazio → nada casa.
 */
function friendsOnlyWhere(followingIds: string[]): Prisma.EventWhereInput {
  return {
    OR: [
      { authorId: { in: followingIds } },
      {
        attendances: {
          some: {
            userId: { in: followingIds },
            type: { in: POSITIVE_ATTENDANCE },
          },
        },
      },
    ],
  }
}

/**
 * Eventos para o heatmap dentro do bbox.
 * Peso = 2 * CONFIRMED + 1 * INTERESTED + STATUS_HEATMAP_BOOST[status].
 * Mobile renderiza heatmap a partir desses pontos brutos. `followingIds` (vazio
 * quando sem friendsOnly/sem viewer) é resolvido no service, mantendo o
 * repositório sem conhecer outros módulos.
 */
export async function findEventsForMap(
  query: MapEventsQuery,
  followingIds: string[],
  now: Date = new Date(),
): Promise<MapEventPoint[]> {
  const bbox: Bbox = {
    north: query.bboxNorth,
    south: query.bboxSouth,
    east: query.bboxEast,
    west: query.bboxWest,
  }

  const idsInBbox = await findEventIdsInBbox(bbox, MAP_BBOX_FETCH_CAP)
  if (idsInBbox.length === 0) return []

  const events = await prisma.event.findMany({
    where: {
      AND: [
        { id: { in: idsInBbox } },
        { isPublic: true },
        { author: visibleAuthorWhere() },
        buildMapLifecycleWhere({
          status: query.status,
          now,
          recentPastMs: RECENT_PAST_MS,
        }),
        ...(query.friendsOnly ? [friendsOnlyWhere(followingIds)] : []),
        ...(query.category && query.category.length > 0
          ? [{ categories: { hasSome: query.category } }]
          : []),
        ...(query.dateFrom || query.dateTo
          ? [
              {
                date: {
                  ...(query.dateFrom && { gte: new Date(query.dateFrom) }),
                  ...(query.dateTo && { lte: new Date(query.dateTo) }),
                },
              },
            ]
          : []),
      ],
    },
    select: {
      id: true,
      latitude: true,
      longitude: true,
      date: true,
      endDate: true,
      canceledAt: true,
    },
  })
  if (events.length === 0) return []

  const eventIds = events.map((e) => e.id)
  const grouped = await prisma.eventAttendance.groupBy({
    by: ['eventId', 'type'],
    where: { eventId: { in: eventIds } },
    _count: { _all: true },
  })

  const engagement = new Map<string, number>()
  for (const row of grouped) {
    const w = row.type === 'CONFIRMED' ? 2 : row.type === 'INTERESTED' ? 1 : 0
    engagement.set(
      row.eventId,
      (engagement.get(row.eventId) ?? 0) + row._count._all * w,
    )
  }

  const points = events.map((e) => {
    const status = computeEventStatus(e, now)
    return {
      id: e.id,
      latitude: e.latitude,
      longitude: e.longitude,
      weight: (engagement.get(e.id) ?? 0) + STATUS_HEATMAP_BOOST[status],
    }
  })
  points.sort((a, b) => b.weight - a.weight)
  return points.slice(0, MAP_RESPONSE_CAP)
}

export type TopAttendance = { user: AuthorPayload; isFriend: boolean }

type TopAttendanceRow = AuthorPayload & {
  eventid: string
  isfriend: boolean
}

/**
 * Participantes em destaque por evento (top {@link TOP_ATTENDANCES_LIMIT}),
 * ordenados: amigos primeiro, depois confirmados antes de interessados, depois
 * por recência. Um ROW_NUMBER por evento limita no SQL (sem trazer presenças
 * demais). Cada item carrega `isFriend` para o caller derivar friendAttendances
 * (subconjunto de amigos) sem uma segunda query.
 */
export async function findTopAttendancesByEvent(
  eventIds: string[],
  followingIds: string[],
): Promise<Map<string, TopAttendance[]>> {
  const map = new Map<string, TopAttendance[]>()
  if (eventIds.length === 0) return map

  // followingIds vazio → ninguém é amigo (anônimo ou sem rede): a coluna vira
  // FALSE e a ordenação cai só em prioridade/recência.
  const isFriendExpr = followingIds.length
    ? Prisma.sql`a."userId" IN (${Prisma.join(followingIds)})`
    : Prisma.sql`FALSE`

  const rows = await prisma.$queryRaw<TopAttendanceRow[]>(Prisma.sql`
    SELECT ranked."eventId" AS eventid,
           ranked.is_friend AS isfriend,
           u.id, u.name, u.lastname, u.username, u."avatarUrl"
    FROM (
      SELECT a."eventId", a."userId",
             (${isFriendExpr}) AS is_friend,
             ROW_NUMBER() OVER (
               PARTITION BY a."eventId"
               ORDER BY (${isFriendExpr}) DESC,
                        CASE a.type WHEN 'CONFIRMED' THEN 0 ELSE 1 END ASC,
                        a."createdAt" DESC
             ) AS rn
      FROM event_attendances a
      WHERE a."eventId" IN (${Prisma.join(eventIds)})
        AND a.type IN ('CONFIRMED', 'INTERESTED')
        -- Só participantes ativos entram no ranking (top-5 sem buracos).
        -- Equivale ao activeUserWhere() (lib/account-visibility): aqui é raw SQL,
        -- então o literal 'ACTIVE' é intencional — manter em sincronia com o enum.
        AND EXISTS (
          SELECT 1 FROM users uu
          WHERE uu.id = a."userId" AND uu."accountStatus" = 'ACTIVE'
        )
    ) ranked
    JOIN users u ON u.id = ranked."userId"
    WHERE ranked.rn <= ${TOP_ATTENDANCES_LIMIT}
    ORDER BY ranked."eventId", ranked.rn
  `)

  for (const r of rows) {
    const arr = map.get(r.eventid) ?? []
    arr.push({
      user: {
        id: r.id,
        name: r.name,
        lastname: r.lastname,
        username: r.username,
        avatarUrl: r.avatarUrl,
      },
      isFriend: r.isfriend,
    })
    map.set(r.eventid, arr)
  }
  return map
}

/**
 * Eventos completos (shared shape) dentro do bbox para o mapa renderizar
 * pins/clusters. Aplica visibilidade, regra das 48h (passado recente),
 * categoria, status e (opcional) friendsOnly. `truncated` indica que havia
 * mais eventos que o `limit` — o front sugere "aproxime para ver mais".
 */
export async function findEventsInViewport(
  query: ViewportQuery,
  followingIds: string[],
  now: Date = new Date(),
): Promise<{ events: SharedEvent[]; truncated: boolean }> {
  const bbox: Bbox = {
    north: query.bboxNorth,
    south: query.bboxSouth,
    east: query.bboxEast,
    west: query.bboxWest,
  }

  const idsInBbox = await findEventIdsInBbox(bbox, MAP_BBOX_FETCH_CAP)
  if (idsInBbox.length === 0) return { events: [], truncated: false }

  const rows = (await prisma.event.findMany({
    where: {
      AND: [
        { id: { in: idsInBbox } },
        { isPublic: true },
        { author: visibleAuthorWhere() },
        buildMapLifecycleWhere({
          status: query.status,
          now,
          recentPastMs: RECENT_PAST_MS,
        }),
        ...(query.friendsOnly ? [friendsOnlyWhere(followingIds)] : []),
        ...(query.category && query.category.length > 0
          ? [{ categories: { hasSome: query.category } }]
          : []),
      ],
    },
    // +1 pra detectar truncamento sem uma query de contagem extra.
    take: query.limit + 1,
    orderBy: [{ isFeatured: 'desc' }, { date: 'asc' }, { id: 'asc' }],
    // Include enxuto do mapa (sem comentários, só capa) — normalizeShared
    // produz recentComments: [] quando a relação não vem.
    include: buildMapIncludes(),
  })) as unknown as PrismaSharedEvent[]

  const truncated = rows.length > query.limit
  const page = truncated ? rows.slice(0, query.limit) : rows
  return { events: page.map((e) => normalizeShared(e, now)), truncated }
}

/**
 * Busca textual global por título/descrição/endereço (case-insensitive),
 * paginada por cursor. Respeita visibilidade e a regra das 48h.
 */
export async function searchEvents(
  q: string,
  limit: number,
  cursor: string | undefined,
  now: Date = new Date(),
): Promise<SharedEvent[]> {
  const events = (await prisma.event.findMany({
    where: {
      AND: [
        { isPublic: true },
        { author: visibleAuthorWhere() },
        buildMapLifecycleWhere({ now, recentPastMs: RECENT_PAST_MS }),
        {
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { description: { contains: q, mode: 'insensitive' } },
            { address: { contains: q, mode: 'insensitive' } },
          ],
        },
      ],
    },
    take: limit,
    ...(cursor && { skip: 1, cursor: { id: cursor } }),
    orderBy: [{ isFeatured: 'desc' }, { date: 'asc' }, { id: 'asc' }],
    include: buildSharedIncludes(),
  })) as unknown as PrismaSharedEvent[]

  return events.map((e) => normalizeShared(e, now))
}

export async function createEvent(
  data: CreateEventBody & { authorId: string },
) {
  return prisma.event.create({
    data: {
      ...data,
      date: new Date(data.date),
      ...(data.endDate && { endDate: new Date(data.endDate) }),
    },
  })
}

export async function updateEvent(id: string, data: UpdateEventBody) {
  return prisma.event.update({ where: { id }, data })
}

export async function deleteEvent(id: string) {
  return prisma.event.delete({ where: { id } })
}

export async function createEventImage(
  eventId: string,
  data: Omit<Prisma.EventImageUncheckedCreateInput, 'eventId' | 'order'>,
) {
  const agg = await prisma.eventImage.aggregate({
    where: { eventId },
    _max: { order: true },
  })
  const nextOrder = (agg._max.order ?? -1) + 1
  return prisma.eventImage.create({
    data: { ...data, eventId, order: nextOrder },
  })
}

export async function findEventImageKeys(eventId: string) {
  return prisma.eventImage.findMany({
    where: { eventId },
    select: { key: true },
  })
}
