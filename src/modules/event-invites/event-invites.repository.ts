import { prisma } from '../../lib/prisma'

export async function createInvites(
  eventId: string,
  inviterId: string,
  invitedIds: string[],
) {
  return prisma.eventInvite.createMany({
    data: invitedIds.map((invitedId) => ({ eventId, inviterId, invitedId })),
    skipDuplicates: true,
  })
}

export async function findInvite(eventId: string, userId: string) {
  return prisma.eventInvite.findUnique({
    where: { eventId_invitedId: { eventId, invitedId: userId } },
  })
}

export async function findFollowerIds(userId: string) {
  const follows = await prisma.follow.findMany({
    where: { followingId: userId, status: 'ACCEPTED' },
    select: { followerId: true },
  })
  return follows.map((f) => f.followerId)
}

export async function findEventInvites(eventId: string) {
  return prisma.eventInvite.findMany({
    where: { eventId },
    include: {
      invited: {
        select: { id: true, name: true, lastname: true, username: true, avatarUrl: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })
}
