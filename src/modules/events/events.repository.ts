import { type AttendanceType, Prisma } from '@prisma/client'
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
  type DistanceCursor,
  decodeDistanceCursor,
  decodePopularityCursor,
  type EventDistanceRow,
  encodeDistanceCursor,
  encodePopularityCursor,
  findEventIdsAtExactDistance,
  findEventIdsByDistanceKeyset,
  findEventIdsByPopularityKeyset,
  findEventIdsInBbox,
  findEventIdsWithinRadius,
  type PopularityCursor,
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
      orderBy: { createdAt: 'desc' },
      // 1 comentário: o feed (EventCard) só renderiza recentComments[0] no
      // preview; a tela expandida/detalhe carrega os comentários completos por
      // endpoint dedicado. Buscar 2 era over-fetch que ninguém renderiza.
      take: 1,
      include: buildCommentInclude(),
    },
    images: {
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      // 1 imagem: o feed (EventCard) renderiza só images[0] como capa; o
      // detalhe carrega a galeria completa via endpoint dedicado.
      take: 1,
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
  >,
  limit: number,
  cursor?: string,
  viewerId?: string,
  now: Date = new Date(),
): Promise<{ events: SharedEvent[]; nextCursor: string | null }> {
  let spatialIdFilter: string[] | undefined

  if (
    filters.radiusKm !== undefined &&
    filters.nearLat !== undefined &&
    filters.nearLng !== undefined
  ) {
    spatialIdFilter = await findEventIdsWithinRadius(
      { latitude: filters.nearLat, longitude: filters.nearLng },
      filters.radiusKm,
      {
        category: filters.category,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        status: filters.status,
        includePast: filters.includePast,
        now,
      },
      viewerId,
    )
    if (spatialIdFilter.length === 0) return { events: [], nextCursor: null }
  }

  // Busca limit+1 pra saber se há próxima página: gerar nextCursor só
  // porque vieram `limit` resultados produz cursor falso (próxima página
  // vazia) quando o total é exatamente `limit`. Espelha os repos
  // findPublicEventsByDistance e findPublicEventsByPopularity.
  const rows = (await prisma.event.findMany({
    where: {
      AND: [
        { isPublic: true },
        authorVisibleWhere(viewerId),
        buildLifecycleWhere({
          includePast: filters.includePast ?? false,
          status: filters.status,
          now,
        }),
        ...(spatialIdFilter ? [{ id: { in: spatialIdFilter } }] : []),
        ...(filters.category && filters.category.length > 0
          ? [{ category: { in: filters.category } }]
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
    take: limit + 1,
    ...(cursor && { skip: 1, cursor: { id: cursor } }),
    orderBy: [{ isFeatured: 'desc' }, { date: 'asc' }, { id: 'asc' }],
    include: buildSharedIncludes(),
  })) as unknown as PrismaSharedEvent[]

  const hasMore = rows.length > limit
  const pageRows = hasMore ? rows.slice(0, limit) : rows
  const events = pageRows.map((e) => normalizeShared(e, now))
  const nextCursor = hasMore ? pageRows[pageRows.length - 1].id : null
  return { events, nextCursor }
}

/**
 * Listagem pública ordenada por distância (KNN com paginação keyset).
 *
 * Os filtros (lifecycle/categoria/data/visibilidade) vão pro SQL do keyset,
 * que devolve exatamente `limit` IDs já filtrados — o Prisma só hidrata os
 * includes por `id IN` (sem re-filtrar) e reordena pela ordem do KNN. Assim
 * a página nunca volta incompleta por filtro aplicado tarde demais, e o
 * `nextCursor` é o último item visitado pelo KNN.
 */
export async function findPublicEventsByDistance(
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
  >,
  limit: number,
  cursor?: string,
  viewerId?: string,
  now: Date = new Date(),
): Promise<{ events: SharedEvent[]; nextCursor: string | null }> {
  if (filters.nearLat === undefined || filters.nearLng === undefined) {
    return { events: [], nextCursor: null }
  }

  let after: DistanceCursor | undefined
  if (cursor) {
    const parsed = decodeDistanceCursor(cursor)
    if (parsed === null) {
      throw { statusCode: 400, message: 'Cursor de paginação inválido' }
    }
    after = parsed
  }

  // Busca limit+1 pra saber se há próxima página: gerar nextCursor só
  // porque vieram `limit` resultados produz cursor falso (próxima página
  // vazia) quando o total é exatamente `limit`.
  const knnRows = await findEventIdsByDistanceKeyset({
    center: { latitude: filters.nearLat, longitude: filters.nearLng },
    limit: limit + 1,
    radiusKm: filters.radiusKm,
    after,
    filters: {
      category: filters.category,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      status: filters.status,
      includePast: filters.includePast,
      now,
    },
    viewerId,
  })
  if (knnRows.length === 0) return { events: [], nextCursor: null }

  let hasMore = knnRows.length > limit
  const pageRows: EventDistanceRow[] = hasMore
    ? knnRows.slice(0, limit)
    : knnRows.slice()

  // Drain do grupo de empate na borda: se o peek (knnRows[limit]) tem MESMA
  // distância do último da página, o grupo de empate cruza a borda. Com
  // KNN-only a ordem entre empates é não-determinística — sem drenar o resto
  // do grupo, o cursor pula (id < last.id no grupo, "perdido") ou repete
  // (id > last.id, "duplicado") na próxima página. O drain busca os
  // restantes do grupo até `MAX_TIE_DRAIN` e o cursor avança pro MAX(id)
  // de todos os ties da página — garantindo cobertura total sem dup.
  const lastDist = pageRows[pageRows.length - 1].dist
  const tieAtBoundary = hasMore && knnRows[limit].dist === lastDist
  if (tieAtBoundary) {
    const drainedIds = await findEventIdsAtExactDistance({
      center: { latitude: filters.nearLat, longitude: filters.nearLng },
      dist: lastDist,
      excludeIds: pageRows.map((r) => r.id),
      filters: {
        category: filters.category,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        status: filters.status,
        includePast: filters.includePast,
        now,
      },
      viewerId,
    })
    for (const id of drainedIds) pageRows.push({ id, dist: lastDist })
    // Conservativo: mesmo sem o peek de dist > lastDist, mantemos hasMore=true.
    // Pior caso é a próxima página vir vazia — UX aceita; a alternativa seria
    // outra query só pra confirmar, paga toda página com tie na borda.
    hasMore = true
  }

  const events = (await prisma.event.findMany({
    where: { id: { in: pageRows.map((r) => r.id) } },
    include: buildSharedIncludes(),
  })) as unknown as PrismaSharedEvent[]

  const byId = new Map(events.map((e) => [e.id, e]))
  const ordered = pageRows
    .map((r) => byId.get(r.id))
    .filter((e): e is PrismaSharedEvent => e !== undefined)

  // Cursor avança pro MAX(id) entre TODOS os eventos da página com a última
  // distância (originais + drenados). Combinado com o drain acima, o WHERE
  // do cursor `id > MAX AND dist == lastDist` retorna ∅ no grupo de empate
  // — a próxima página só vê eventos com dist > lastDist.
  const tieMaxId = pageRows
    .filter((r) => r.dist === lastDist)
    .reduce((max, r) => (r.id > max ? r.id : max), '')
  const nextCursor = hasMore
    ? encodeDistanceCursor({ dist: lastDist, id: tieMaxId })
    : null

  return {
    events: ordered.map((e) => normalizeShared(e, now)),
    nextCursor,
  }
}

/**
 * Listagem pública ordenada por popularidade (RF07.6, keyset por score).
 *
 * Mesmo padrão de `findPublicEventsByDistance`: o keyset agrega/filtra no SQL
 * e devolve `limit (+1)` IDs já ordenados por score; o Prisma só hidrata os
 * includes por `id IN` e reordena pela ordem do keyset. `radiusKm` opcional
 * (popularidade "perto de mim").
 */
export async function findPublicEventsByPopularity(
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
  >,
  limit: number,
  cursor?: string,
  viewerId?: string,
  now: Date = new Date(),
): Promise<{ events: SharedEvent[]; nextCursor: string | null }> {
  let after: PopularityCursor | undefined
  if (cursor) {
    const parsed = decodePopularityCursor(cursor)
    if (parsed === null) {
      throw { statusCode: 400, message: 'Cursor de paginação inválido' }
    }
    after = parsed
  }

  const center =
    filters.nearLat !== undefined && filters.nearLng !== undefined
      ? { latitude: filters.nearLat, longitude: filters.nearLng }
      : undefined

  const rankRows = await findEventIdsByPopularityKeyset({
    limit: limit + 1,
    after,
    center,
    radiusKm: filters.radiusKm,
    filters: {
      category: filters.category,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      status: filters.status,
      includePast: filters.includePast,
      now,
    },
    viewerId,
  })
  if (rankRows.length === 0) return { events: [], nextCursor: null }

  const hasMore = rankRows.length > limit
  const pageRows = hasMore ? rankRows.slice(0, limit) : rankRows

  const events = (await prisma.event.findMany({
    where: { id: { in: pageRows.map((r) => r.id) } },
    include: buildSharedIncludes(),
  })) as unknown as PrismaSharedEvent[]

  const byId = new Map(events.map((e) => [e.id, e]))
  const ordered = pageRows
    .map((r) => byId.get(r.id))
    .filter((e): e is PrismaSharedEvent => e !== undefined)

  const last = pageRows[pageRows.length - 1]
  const nextCursor = hasMore
    ? encodePopularityCursor({ score: last.score, id: last.id })
    : null

  return {
    events: ordered.map((e) => normalizeShared(e, now)),
    nextCursor,
  }
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

export async function findEventById(
  id: string,
  now: Date = new Date(),
): Promise<SharedEvent | null> {
  const event = (await prisma.event.findUnique({
    where: { id },
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
  viewerId: string | undefined,
  followingIds: string[],
  now: Date = new Date(),
): Promise<MapEventPoint[]> {
  const bbox: Bbox = {
    north: query.bboxNorth,
    south: query.bboxSouth,
    east: query.bboxEast,
    west: query.bboxWest,
  }

  const idsInBbox = await findEventIdsInBbox(bbox, MAP_BBOX_FETCH_CAP, viewerId)
  if (idsInBbox.length === 0) return []

  const events = await prisma.event.findMany({
    where: {
      AND: [
        { id: { in: idsInBbox } },
        { isPublic: true },
        authorVisibleWhere(viewerId),
        buildMapLifecycleWhere({
          status: query.status,
          now,
          recentPastMs: RECENT_PAST_MS,
        }),
        ...(query.friendsOnly ? [friendsOnlyWhere(followingIds)] : []),
        ...(query.category && query.category.length > 0
          ? [{ category: { in: query.category } }]
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
  viewerId: string | undefined,
  followingIds: string[],
  now: Date = new Date(),
): Promise<{ events: SharedEvent[]; truncated: boolean }> {
  const bbox: Bbox = {
    north: query.bboxNorth,
    south: query.bboxSouth,
    east: query.bboxEast,
    west: query.bboxWest,
  }

  const idsInBbox = await findEventIdsInBbox(bbox, MAP_BBOX_FETCH_CAP, viewerId)
  if (idsInBbox.length === 0) return { events: [], truncated: false }

  const rows = (await prisma.event.findMany({
    where: {
      AND: [
        { id: { in: idsInBbox } },
        { isPublic: true },
        authorVisibleWhere(viewerId),
        buildMapLifecycleWhere({
          status: query.status,
          now,
          recentPastMs: RECENT_PAST_MS,
        }),
        ...(query.friendsOnly ? [friendsOnlyWhere(followingIds)] : []),
        ...(query.category && query.category.length > 0
          ? [{ category: { in: query.category } }]
          : []),
      ],
    },
    // +1 pra detectar truncamento sem uma query de contagem extra.
    take: query.limit + 1,
    orderBy: [{ isFeatured: 'desc' }, { date: 'asc' }, { id: 'asc' }],
    include: buildSharedIncludes(),
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
  viewerId: string | undefined,
  now: Date = new Date(),
): Promise<SharedEvent[]> {
  const events = (await prisma.event.findMany({
    where: {
      AND: [
        { isPublic: true },
        authorVisibleWhere(viewerId),
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
