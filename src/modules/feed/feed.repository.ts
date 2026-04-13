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
  return prisma.event.findMany({
    where: {
      AND: [
        // Eventos de quem você segue ou com checkin de quem você segue
        {
          OR: [
            { authorId: { in: followingIds } },
            { attendances: { some: { userId: { in: followingIds } } } },
          ],
        },
        // Apenas eventos que o viewer pode ver
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
        where: { userId: { in: followingIds } },
        include: { user: { select: authorSelect } },
        take: 3,
      },
      _count: {
        select: { attendances: true, comments: true, reactions: true },
      },
    },
  })
}

export async function findFollowingIds(userId: string) {
  const follows = await prisma.follow.findMany({
    where: { followerId: userId, status: 'ACCEPTED' },
    select: { followingId: true },
  })
  return follows.map((f) => f.followingId)
}
