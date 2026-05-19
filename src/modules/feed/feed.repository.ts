import { type AttendanceType, Prisma } from '@prisma/client'
import { buildLifecycleWhere } from '../../lib/event-filters'
import { computeEventStatus } from '../../lib/event-lifecycle'
import { prisma } from '../../lib/prisma'
import { buildCommentInclude } from '../comments/comments.repository'
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
  friendAttendances: { userId: string; type: string; user: FeedUser }[],
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

  return { kind: 'self_interaction' }
}

export async function findFeedCandidates(
  viewerId: string,
  followingIds: string[],
  query: FeedQuery,
  take: number,
  cursor?: string,
) {
  const now = new Date()

  const lifecycleWhere = buildLifecycleWhere({
    includePast: query.includePast,
    status: query.status,
    now,
  })

  const dateRange =
    query.dateFrom || query.dateTo
      ? {
          date: {
            ...(query.dateFrom && { gte: new Date(query.dateFrom) }),
            ...(query.dateTo && { lte: new Date(query.dateTo) }),
          },
        }
      : null

  const categoryWhere =
    query.category && query.category.length > 0
      ? { category: { in: query.category } }
      : null

  const events = await prisma.event.findMany({
    where: {
      AND: [
        lifecycleWhere,
        ...(categoryWhere ? [categoryWhere] : []),
        ...(dateRange ? [dateRange] : []),
        {
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
        },
        {
          OR: [
            { isPublic: true },
            { authorId: viewerId },
            { invites: { some: { invitedId: viewerId } } },
          ],
        },
      ],
    },
    take,
    ...(cursor && { skip: 1, cursor: { id: cursor } }),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: {
      author: { select: authorSelect },
      attendances: {
        where: {
          userId: { in: followingIds },
          type: { in: POSITIVE_ATTENDANCE },
        },
        include: { user: { select: authorSelect } },
        orderBy: { createdAt: 'desc' as const },
        take: 3,
      },
      reactions: {
        where: { userId: viewerId },
        select: { id: true },
        take: 1,
      },
      comments: {
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

  const eventIds = events.map((e) => e.id)

  const [viewerAttendances, friendReactions, friendComments] =
    await Promise.all([
      prisma.eventAttendance.findMany({
        where: { eventId: { in: eventIds }, userId: viewerId },
        select: { eventId: true, type: true },
      }),
      followingIds.length > 0
        ? prisma.reaction.findMany({
            where: { eventId: { in: eventIds }, userId: { in: followingIds } },
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
    const { reactions, attendances, comments, ...rest } = event

    const userAttendance = viewerAttendanceMap.get(event.id) ?? null
    const userLiked = reactions.length > 0

    const reason = resolveReason(
      event.id,
      event.author,
      event.authorId,
      viewerId,
      followingIds,
      userAttendance,
      userLiked,
      attendances,
      friendReactionsByEvent,
      friendCommentsByEvent,
    )

    return {
      ...rest,
      friendAttendances: attendances.map((a) => ({ user: a.user })),
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

export async function findFollowingIds(userId: string) {
  const follows = await prisma.follow.findMany({
    where: { followerId: userId, status: 'ACCEPTED' },
    select: { followingId: true },
  })
  return follows.map((f) => f.followingId)
}

/**
 * Top categorias do histórico do usuário (eventos criados ou com presença).
 * Retorna até PREFERRED_CATEGORIES_LIMIT, em ordem de frequência decrescente.
 */
export async function findUserPreferredCategories(
  userId: string,
): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ category: string }[]>(
    Prisma.sql`
      SELECT e.category
      FROM events e
      LEFT JOIN event_attendances a
        ON a."eventId" = e.id
        AND a."userId" = ${userId}
        AND a.type IN ('CONFIRMED', 'INTERESTED')
      WHERE e."authorId" = ${userId} OR a."userId" = ${userId}
      GROUP BY e.category
      ORDER BY COUNT(*) DESC, e.category ASC
      LIMIT ${PREFERRED_CATEGORIES_LIMIT}
    `,
  )
  return rows.map((r) => r.category)
}
