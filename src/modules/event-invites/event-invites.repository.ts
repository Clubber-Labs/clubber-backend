import { activeUserWhere } from '../../lib/account-visibility'
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

/**
 * Elegibilidade para convite por terceiros (evento público): conta ativa e
 * perfil público, ou privado com follow mútuo ACCEPTED com o convidador — o
 * mesmo vínculo de "amigo" do chat. Filtro em lote, uma query para N alvos.
 */
export async function findInvitableIds(
  inviterId: string,
  candidateIds: string[],
) {
  if (candidateIds.length === 0) return []
  const users = await prisma.user.findMany({
    where: {
      id: { in: candidateIds },
      ...activeUserWhere(),
      OR: [
        { isPrivate: false },
        {
          AND: [
            {
              followers: {
                some: { followerId: inviterId, status: 'ACCEPTED' },
              },
            },
            {
              following: {
                some: { followingId: inviterId, status: 'ACCEPTED' },
              },
            },
          ],
        },
      ],
    },
    select: { id: true },
  })
  return users.map((u) => u.id)
}

export async function findInvitedIdsIn(eventId: string, userIds: string[]) {
  if (userIds.length === 0) return new Set<string>()
  const rows = await prisma.eventInvite.findMany({
    where: { eventId, invitedId: { in: userIds } },
    select: { invitedId: true },
  })
  return new Set(rows.map((r) => r.invitedId))
}

export async function findEventInvites(eventId: string) {
  return prisma.eventInvite.findMany({
    where: { eventId, invited: activeUserWhere() },
    include: {
      invited: {
        select: {
          id: true,
          name: true,
          lastname: true,
          username: true,
          avatarUrl: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })
}
