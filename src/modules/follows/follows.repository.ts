import type { FollowStatus } from '@prisma/client'
import { uuidv7 } from 'uuidv7'
import { prisma } from '../../lib/prisma'

export async function createFollow(
  followerId: string,
  followingId: string,
  status: FollowStatus = 'ACCEPTED',
) {
  const follow = await prisma.$transaction(async (tx) => {
    const f = await tx.follow.create({
      data: {
        id: uuidv7(),
        followerId,
        followingId,
        status,
      },
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

    return f
  })

  return follow
}

export async function acceptFollowRequest(followId: string) {
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
    const follow = await tx.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId,
          followingId,
        },
      },
    })

    if (follow) {
      await tx.follow.delete({
        where: { id: follow.id },
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
    }
  })
}

export async function findFollow(followerId: string, followingId: string) {
  return prisma.follow.findUnique({
    where: {
      followerId_followingId: {
        followerId,
        followingId,
      },
    },
  })
}

export async function findFollowers(
  userId: string,
  limit = 20,
  cursor?: string,
) {
  return prisma.follow.findMany({
    where: {
      followingId: userId,
      status: 'ACCEPTED',
    },
    take: limit,
    ...(cursor && { skip: 1, cursor: { id: cursor } }),
    orderBy: { id: 'desc' },
    include: {
      follower: {
        select: {
          id: true,
          name: true,
          username: true,
        },
      },
    },
  })
}

export async function findFollowing(
  userId: string,
  limit = 20,
  cursor?: string,
) {
  return prisma.follow.findMany({
    where: {
      followerId: userId,
      status: 'ACCEPTED',
    },
    take: limit,
    ...(cursor && { skip: 1, cursor: { id: cursor } }),
    orderBy: { id: 'desc' },
    include: {
      following: {
        select: {
          id: true,
          name: true,
          username: true,
        },
      },
    },
  })
}
