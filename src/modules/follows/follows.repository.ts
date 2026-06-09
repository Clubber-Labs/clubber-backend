import type { FollowStatus } from '@prisma/client'
import { activeUserWhere } from '../../lib/account-visibility'
import { prisma } from '../../lib/prisma'

const followerSelect = {
  id: true,
  name: true,
  lastname: true,
  username: true,
  avatarUrl: true,
} as const

/** IDs que o usuário segue com follow aceito — definição de "amigo" no app. */
export async function findAcceptedFollowingIds(userId: string) {
  const follows = await prisma.follow.findMany({
    where: { followerId: userId, status: 'ACCEPTED' },
    select: { followingId: true },
  })
  return follows.map((f) => f.followingId)
}

export async function createFollow(
  followerId: string,
  followingId: string,
  status: FollowStatus,
) {
  return prisma.$transaction(async (tx) => {
    const follow = await tx.follow.create({
      data: { followerId, followingId, status },
    })

    if (status === 'ACCEPTED') {
      await tx.user.update({
        where: { id: followerId },
        data: { followingCount: { increment: 1 } },
      })
      await tx.user.update({
        where: { id: followingId },
        data: { followersCount: { increment: 1 } },
      })
    }

    return follow
  })
}

export async function acceptFollow(followId: string) {
  return prisma.$transaction(async (tx) => {
    const follow = await tx.follow.update({
      where: { id: followId },
      data: { status: 'ACCEPTED' },
    })

    await tx.user.update({
      where: { id: follow.followerId },
      data: { followingCount: { increment: 1 } },
    })
    await tx.user.update({
      where: { id: follow.followingId },
      data: { followersCount: { increment: 1 } },
    })

    return follow
  })
}

export async function deleteFollow(followerId: string, followingId: string) {
  return prisma.$transaction(async (tx) => {
    const follow = await tx.follow.delete({
      where: { followerId_followingId: { followerId, followingId } },
    })

    if (follow.status === 'ACCEPTED') {
      await tx.user.update({
        where: { id: followerId },
        data: { followingCount: { decrement: 1 } },
      })
      await tx.user.update({
        where: { id: followingId },
        data: { followersCount: { decrement: 1 } },
      })
    }

    return follow
  })
}

export async function findFollow(followerId: string, followingId: string) {
  return prisma.follow.findUnique({
    where: { followerId_followingId: { followerId, followingId } },
  })
}

export async function findFollowStatusesByFollower(
  followerId: string,
  followingIds: string[],
): Promise<Map<string, FollowStatus>> {
  if (followingIds.length === 0) return new Map()

  const rows = await prisma.follow.findMany({
    where: { followerId, followingId: { in: followingIds } },
    select: { followingId: true, status: true },
  })

  return new Map(rows.map((r) => [r.followingId, r.status]))
}

export async function findFollowers(
  userId: string,
  limit: number,
  cursor?: string,
) {
  return prisma.follow.findMany({
    where: {
      followingId: userId,
      status: 'ACCEPTED',
      follower: activeUserWhere(),
    },
    take: limit,
    ...(cursor && { skip: 1, cursor: { id: cursor } }),
    orderBy: { id: 'desc' },
    include: { follower: { select: followerSelect } },
  })
}

export async function findFollowing(
  userId: string,
  limit: number,
  cursor?: string,
) {
  return prisma.follow.findMany({
    where: {
      followerId: userId,
      status: 'ACCEPTED',
      following: activeUserWhere(),
    },
    take: limit,
    ...(cursor && { skip: 1, cursor: { id: cursor } }),
    orderBy: { id: 'desc' },
    include: { following: { select: followerSelect } },
  })
}

export async function findPendingRequests(
  userId: string,
  limit: number,
  cursor?: string,
) {
  return prisma.follow.findMany({
    where: {
      followingId: userId,
      status: 'PENDING',
      follower: activeUserWhere(),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    ...(cursor && { skip: 1, cursor: { id: cursor } }),
    include: { follower: { select: followerSelect } },
  })
}
