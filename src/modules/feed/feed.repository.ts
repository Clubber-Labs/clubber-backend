import { prisma } from '../../lib/prisma'

const authorSelect = {
  id: true,
  name: true,
  lastname: true,
  username: true,
} as const

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
    orderBy: { createdAt: 'desc' },
    include: {
      author: { select: authorSelect },
      attendances: {
        where: { userId: { in: [...followingIds, viewerId] } },
        include: { user: { select: authorSelect } },
        orderBy: { createdAt: 'desc' as const },
        take: 4,
      },
      reactions: {
        where: { userId: viewerId },
        select: { type: true },
        take: 1,
      },
      comments: {
        orderBy: { createdAt: 'desc' },
        take: 2,
        include: { author: { select: authorSelect } },
      },
      _count: {
        select: { attendances: true, comments: true, reactions: true },
      },
    },
  })

  return events.map(event => {
    const { reactions, attendances, comments, ...rest } = event as typeof event & {
      reactions: { type: string }[]
    }

    type AttendanceWithUser = { userId: string; type: string; user: { id: string; name: string; lastname: string; username: string } }
    const typedAttendances = attendances as unknown as AttendanceWithUser[]

    const userAttendanceRecord = typedAttendances.find(a => a.userId === viewerId)
    const friendAttendances = typedAttendances.filter(a => a.userId !== viewerId).slice(0, 3)

    return {
      ...rest,
      friendAttendances,
      recentComments: comments.map(c => ({
        id: c.id,
        content: c.content,
        createdAt: c.createdAt,
        author: c.author,
      })),
      userReaction: reactions.length ? reactions[0].type : null,
      userAttendance: userAttendanceRecord?.type ?? null,
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
