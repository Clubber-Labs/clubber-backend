import { type AttendanceType, Prisma } from '@prisma/client'
import {
  activeUserWhere,
  visibleAuthorWhere,
} from '../../lib/account-visibility'
import type { EventCategory } from '../../lib/event-categories'
import { buildLifecycleWhere } from '../../lib/event-filters'
import { computeEventStatus } from '../../lib/event-lifecycle'
import { prisma } from '../../lib/prisma'
import { findEventIdsByDistance, type LatLng } from '../../lib/spatial'
import { buildCommentInclude } from '../comments/comments.repository'
import { findTopAttendancesByEvent } from '../events/events.repository'
import type { FeedQuery } from './feed.schema'

const PREFERRED_CATEGORIES_LIMIT = 3

const POSITIVE_ATTENDANCE: AttendanceType[] = ['CONFIRMED', 'INTERESTED']

const authorSelect = {
  id: true,
  name: true,
  lastname: true,
  username: true,
  avatarUrl: true,
} as const

type FeedUser = Prisma.UserGetPayload<{ select: typeof authorSelect }>

export type FeedReason =
  | { kind: 'self_created' }
  | { kind: 'friend_created'; user: FeedUser }
  | { kind: 'friend_attending'; user: FeedUser; type: string }
  | { kind: 'friend_reacted'; user: FeedUser }
  | { kind: 'friend_commented'; user: FeedUser; preview: string }
  | { kind: 'self_interaction' }
  | { kind: 'discovery' }

type FriendReactionRow = {
  eventId: string | null
  userId: string
  user: FeedUser
}
type FriendCommentRow = {
  eventId: string | null
  authorId: string
  content: string
  author: FeedUser
}

function resolveReason(
  eventId: string,
  author: FeedUser,
  authorId: string,
  viewerId: string,
  followingIds: string[],
  userAttendance: string | null,
  userLiked: boolean,
  friendAttendances: { type: string; user: FeedUser }[],
  friendReactionsByEvent: Map<string, FriendReactionRow>,
  friendCommentsByEvent: Map<string, FriendCommentRow>,
): FeedReason {
  if (authorId === viewerId) return { kind: 'self_created' }

  if (userAttendance !== null || userLiked) return { kind: 'self_interaction' }

  if (followingIds.includes(authorId)) {
    return { kind: 'friend_created', user: author }
  }

  const attending = friendAttendances[0]
  if (attending)
    return {
      kind: 'friend_attending',
      user: attending.user,
      type: attending.type,
    }

  const reaction = friendReactionsByEvent.get(eventId)
  if (reaction) return { kind: 'friend_reacted', user: reaction.user }

  const comment = friendCommentsByEvent.get(eventId)
  if (comment)
    return {
      kind: 'friend_commented',
      user: comment.author,
      preview: comment.content.slice(0, 80),
    }

  // Sem laço social: evento veio da pool de descoberta (categoria/proximidade).
  return { kind: 'discovery' }
}

/** Condições WHERE compartilhadas pelas pools social e de descoberta. */
function buildBaseWhere(query: FeedQuery, now: Date): Prisma.EventWhereInput[] {
  const conditions: Prisma.EventWhereInput[] = [
    buildLifecycleWhere({
      includePast: query.includePast,
      status: query.status,
      now,
    }),
  ]

  if (query.category && query.category.length > 0) {
    conditions.push({ categories: { hasSome: query.category } })
  }

  if (query.dateFrom || query.dateTo) {
    conditions.push({
      date: {
        ...(query.dateFrom && { gte: new Date(query.dateFrom) }),
        ...(query.dateTo && { lte: new Date(query.dateTo) }),
      },
    })
  }

  return conditions
}

/** OR social: evento criado/atendido/reagido/comentado por você ou quem você segue. */
function socialOrWhere(
  followingIds: string[],
  viewerId: string,
): Prisma.EventWhereInput {
  return {
    OR: [
      { authorId: { in: [...followingIds, viewerId] } },
      {
        attendances: {
          some: {
            userId: { in: followingIds },
            type: { in: POSITIVE_ATTENDANCE },
          },
        },
      },
      { reactions: { some: { userId: { in: followingIds } } } },
      { comments: { some: { authorId: { in: followingIds } } } },
    ],
  }
}

/** Privacidade do evento: público, do próprio viewer, ou convidado. */
function privacyOrWhere(viewerId: string): Prisma.EventWhereInput {
  return {
    OR: [
      { isPublic: true },
      { authorId: viewerId },
      { invites: { some: { invitedId: viewerId } } },
    ],
  }
}

/**
 * IDs da pool social — eventos ligados à rede do viewer, IGNORANDO distância
 * (amigos distantes aparecem). Aplica lifecycle, visibilidade do autor,
 * filtros da query e privacidade do evento.
 */
export async function findSocialCandidateIds(
  viewerId: string,
  followingIds: string[],
  query: FeedQuery,
  take: number,
  now: Date,
): Promise<string[]> {
  const rows = await prisma.event.findMany({
    where: {
      AND: [
        ...buildBaseWhere(query, now),
        { author: visibleAuthorWhere() },
        socialOrWhere(followingIds, viewerId),
        privacyOrWhere(viewerId),
      ],
    },
    take,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true },
  })
  return rows.map((r) => r.id)
}

/**
 * IDs da pool de descoberta — eventos públicos que combinam com o perfil:
 * categorias preferidas e/ou proximidade (KNN PostGIS). Só roda quando há
 * sinal de perfil (categorias preferidas ou localização); senão retorna [].
 */
// Candidatos ao slot patrocinado da 1ª página: eventos promovidos (isFeatured)
// públicos, vivos, de OUTROS autores, respeitando os filtros do request. Poucos
// ids (cap baixo) — o service escolhe 1 (mais próximo do viewer, se houver
// localização; senão o de data mais próxima).
export async function findPromotedPinCandidates(
  viewerId: string,
  query: FeedQuery,
  now: Date,
  take = 20,
): Promise<{ id: string; latitude: number; longitude: number }[]> {
  return prisma.event.findMany({
    where: {
      AND: [
        ...buildBaseWhere(query, now),
        { isFeatured: true },
        { isPublic: true },
        { authorId: { not: viewerId } },
        { author: visibleAuthorWhere() },
      ],
    },
    take,
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
    select: { id: true, latitude: true, longitude: true },
  })
}

export async function findDiscoveryCandidateIds(
  preferredCategories: EventCategory[],
  center: LatLng | null,
  query: FeedQuery,
  take: number,
  now: Date,
): Promise<string[]> {
  const nearIds = center
    ? await findEventIdsByDistance(center, take, query.radiusKm)
    : []

  const discoveryOr: Prisma.EventWhereInput[] = []
  if (preferredCategories.length > 0) {
    discoveryOr.push({ categories: { hasSome: preferredCategories } })
  }
  if (nearIds.length > 0) {
    discoveryOr.push({ id: { in: nearIds } })
  }
  if (discoveryOr.length === 0) return []

  const rows = await prisma.event.findMany({
    where: {
      AND: [
        ...buildBaseWhere(query, now),
        { isPublic: true },
        { author: visibleAuthorWhere() },
        { OR: discoveryOr },
      ],
    },
    take,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true },
  })
  return rows.map((r) => r.id)
}

/**
 * Conta amigos DISTINTOS que interagiram (presença positiva, reação ou
 * comentário) por evento. O UNION deduplica o mesmo amigo em tipos diferentes.
 * Fonte do friendEngagementSignal — cada amigo a mais sobe o evento.
 */
export async function findFriendInteractionCounts(
  eventIds: string[],
  followingIds: string[],
): Promise<Map<string, number>> {
  if (eventIds.length === 0 || followingIds.length === 0) return new Map()

  const ids = Prisma.join(eventIds)
  const friends = Prisma.join(followingIds)
  const rows = await prisma.$queryRaw<{ eventid: string; friends: number }[]>(
    Prisma.sql`
      SELECT eventid, COUNT(DISTINCT userid)::int AS friends
      FROM (
        SELECT "eventId" AS eventid, "userId" AS userid
          FROM event_attendances
          WHERE "eventId" IN (${ids})
            AND "userId" IN (${friends})
            AND type IN ('CONFIRMED', 'INTERESTED')
        UNION
        SELECT "eventId" AS eventid, "userId" AS userid
          FROM reactions
          WHERE "eventId" IN (${ids}) AND "userId" IN (${friends})
        UNION
        SELECT "eventId" AS eventid, "authorId" AS userid
          FROM comments
          WHERE "eventId" IN (${ids}) AND "authorId" IN (${friends})
      ) interactions
      GROUP BY eventid
    `,
  )
  return new Map(rows.map((r) => [r.eventid, Number(r.friends)]))
}

/**
 * Hidrata os eventos (por id) com author, contadores, comentários recentes,
 * presenças de amigos, estado do viewer, razão social e status. A ordenação
 * final por score fica a cargo do service.
 */
export async function hydrateEvents(
  eventIds: string[],
  viewerId: string,
  followingIds: string[],
  now: Date,
) {
  if (eventIds.length === 0) return []

  const events = await prisma.event.findMany({
    where: { id: { in: eventIds } },
    include: {
      author: { select: authorSelect },
      reactions: {
        where: { userId: viewerId },
        select: { id: true },
        take: 1,
      },
      comments: {
        where: { author: visibleAuthorWhere() },
        orderBy: { createdAt: 'desc' as const },
        take: 2,
        include: buildCommentInclude(viewerId),
      },
      images: {
        orderBy: [{ order: 'asc' as const }, { createdAt: 'asc' as const }],
        select: {
          id: true,
          url: true,
          format: true,
          size: true,
          order: true,
        },
      },
      _count: {
        select: {
          attendances: { where: { type: { in: POSITIVE_ATTENDANCE } } },
          comments: true,
          reactions: true,
        },
      },
    },
  })

  if (events.length === 0) return []

  const [
    viewerAttendances,
    friendReactions,
    friendComments,
    topAttendancesMap,
  ] = await Promise.all([
    prisma.eventAttendance.findMany({
      where: { eventId: { in: eventIds }, userId: viewerId },
      select: { eventId: true, type: true },
    }),
    followingIds.length > 0
      ? prisma.reaction.findMany({
          where: {
            eventId: { in: eventIds },
            userId: { in: followingIds },
            user: activeUserWhere(),
          },
          select: {
            eventId: true,
            userId: true,
            user: { select: authorSelect },
          },
          orderBy: [
            { eventId: 'asc' as const },
            { createdAt: 'desc' as const },
          ],
          distinct: ['eventId'],
        })
      : Promise.resolve([]),
    followingIds.length > 0
      ? prisma.comment.findMany({
          where: {
            eventId: { in: eventIds },
            authorId: { in: followingIds },
            author: activeUserWhere(),
          },
          select: {
            eventId: true,
            authorId: true,
            content: true,
            author: { select: authorSelect },
          },
          orderBy: [
            { eventId: 'asc' as const },
            { createdAt: 'desc' as const },
          ],
          distinct: ['eventId'],
        })
      : Promise.resolve([]),
    // Participantes em destaque (amigos primeiro, depois não-amigos) para os
    // avatares de prova social no card — mesma fonte do mapa.
    findTopAttendancesByEvent(eventIds, followingIds),
  ])

  const viewerAttendanceMap = new Map(
    viewerAttendances.map((a) => [a.eventId, a.type]),
  )
  const friendReactionsByEvent = new Map<string, FriendReactionRow>()
  for (const r of friendReactions as FriendReactionRow[]) {
    if (r.eventId) friendReactionsByEvent.set(r.eventId, r)
  }
  const friendCommentsByEvent = new Map<string, FriendCommentRow>()
  for (const c of friendComments as FriendCommentRow[]) {
    if (c.eventId) friendCommentsByEvent.set(c.eventId, c)
  }

  return events.map((event) => {
    const { reactions, comments, ...rest } = event

    const userAttendance = viewerAttendanceMap.get(event.id) ?? null
    const userLiked = reactions.length > 0

    // Fonte única dos participantes (mesma do mapa): friendAttendances é o
    // subconjunto de amigos do topAttendances, e o reason `friend_attending`
    // usa o amigo de maior prioridade (CONFIRMED > INTERESTED, depois recência).
    const top = topAttendancesMap.get(event.id) ?? []
    const friendTop = top.filter((a) => a.isFriend)

    const reason = resolveReason(
      event.id,
      event.author,
      event.authorId,
      viewerId,
      followingIds,
      userAttendance,
      userLiked,
      friendTop,
      friendReactionsByEvent,
      friendCommentsByEvent,
    )

    return {
      ...rest,
      friendAttendances: friendTop.map((a) => ({ user: a.user })),
      topAttendances: top.map((a) => ({ user: a.user })),
      recentComments: comments.map((c) => ({
        id: c.id,
        content: c.content,
        createdAt: c.createdAt,
        author: c.author,
        reactionsCount: c._count.reactions,
        userLiked: c.reactions.length > 0,
      })),
      userLiked,
      userAttendance,
      reason,
      status: computeEventStatus(event, now),
    }
  })
}

// Fonte única da definição de "amigo" (following aceito), em follows.repository.
export { findAcceptedFollowingIds as findFollowingIds } from '../follows/follows.repository'

/**
 * Categorias preferidas do usuário: as EXPLÍCITAS (escolhidas no perfil) têm
 * prioridade; quando há menos que o limite, completa com as inferidas do
 * histórico (eventos criados ou com presença), sem repetir.
 */
export async function findUserPreferredCategories(
  userId: string,
): Promise<EventCategory[]> {
  const explicit = await prisma.userCategoryPreference.findMany({
    where: { userId },
    select: { category: true },
    orderBy: { createdAt: 'asc' },
  })
  const result: EventCategory[] = explicit.map((p) => p.category)
  if (result.length >= PREFERRED_CATEGORIES_LIMIT) {
    return result.slice(0, PREFERRED_CATEGORIES_LIMIT)
  }

  // Evento tem N categorias: unnest expande cada uma numa linha, então um
  // evento de 2 categorias conta para as duas no ranking do histórico.
  const rows = await prisma.$queryRaw<{ category: EventCategory }[]>(
    Prisma.sql`
      SELECT cat AS category
      FROM events e
      LEFT JOIN event_attendances a
        ON a."eventId" = e.id
        AND a."userId" = ${userId}
        AND a.type IN ('CONFIRMED', 'INTERESTED')
      CROSS JOIN LATERAL unnest(e.categories) AS cat
      WHERE e."authorId" = ${userId} OR a."userId" = ${userId}
      GROUP BY cat
      ORDER BY COUNT(*) DESC, cat ASC
    `,
  )

  for (const row of rows) {
    if (result.length >= PREFERRED_CATEGORIES_LIMIT) break
    if (!result.includes(row.category)) result.push(row.category)
  }

  return result
}
