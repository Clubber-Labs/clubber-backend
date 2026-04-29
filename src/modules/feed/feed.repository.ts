import { prisma } from '../../lib/prisma'

const authorSelect = {
  id: true,
  name: true,
  lastname: true,
  username: true,
} as const

type FeedUser = { id: string; name: string; lastname: string; username: string }

export type FeedReason =
  | { kind: 'self_created' }
  | { kind: 'friend_created'; user: FeedUser }
  | { kind: 'friend_attending'; user: FeedUser; type: string }
  | { kind: 'friend_reacted'; user: FeedUser; type: string }
  | { kind: 'friend_commented'; user: FeedUser; preview: string }
  | { kind: 'self_interaction' }

type FriendReactionRow = {
  eventId: string | null
  userId: string
  type: string
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
  userReaction: string | null,
  friendAttendances: { userId: string; type: string; user: FeedUser }[],
  friendReactionsByEvent: Map<string, FriendReactionRow>,
  friendCommentsByEvent: Map<string, FriendCommentRow>,
): FeedReason {
  if (authorId === viewerId) return { kind: 'self_created' }

  if (userAttendance !== null || userReaction !== null)
    return { kind: 'self_interaction' }

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
  if (reaction)
    return { kind: 'friend_reacted', user: reaction.user, type: reaction.type }

  const comment = friendCommentsByEvent.get(eventId)
  if (comment)
    return {
      kind: 'friend_commented',
      user: comment.author,
      preview: comment.content.slice(0, 80),
    }

  return { kind: 'self_interaction' }
}

export async function findFeedEvents(
  viewerId: string,
  followingIds: string[],
  limit: number,
  cursor?: string,
) {
  const events = await prisma.event.findMany({
    where: {
      AND: [
        {
          OR: [
            { authorId: { in: [...followingIds, viewerId] } },
            { attendances: { some: { userId: { in: followingIds } } } },
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
    take: limit,
    ...(cursor && { skip: 1, cursor: { id: cursor } }),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: {
      author: { select: authorSelect },
      attendances: {
        where: { userId: { in: followingIds } },
        include: { user: { select: authorSelect } },
        orderBy: { createdAt: 'desc' as const },
        take: 3,
      },
      reactions: {
        where: { userId: viewerId },
        select: { type: true },
        take: 1,
      },
      comments: {
        orderBy: { createdAt: 'desc' as const },
        take: 2,
        include: { author: { select: authorSelect } },
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
        select: { attendances: true, comments: true, reactions: true },
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
              type: true,
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
    const userReaction = reactions.length
      ? (reactions[0] as { type: string }).type
      : null
    const friendAttendanceList = attendances as unknown as {
      userId: string
      type: string
      user: FeedUser
    }[]

    const reason = resolveReason(
      event.id,
      event.author,
      event.authorId,
      viewerId,
      followingIds,
      userAttendance,
      userReaction,
      friendAttendanceList,
      friendReactionsByEvent,
      friendCommentsByEvent,
    )

    return {
      ...rest,
      friendAttendances: friendAttendanceList.map((a) => ({ user: a.user })),
      recentComments: (
        comments as unknown as {
          id: string
          content: string
          createdAt: Date
          author: FeedUser
        }[]
      ).map((c) => ({
        id: c.id,
        content: c.content,
        createdAt: c.createdAt,
        author: c.author,
      })),
      userReaction,
      userAttendance,
      reason,
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
