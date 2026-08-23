import { AppError } from '../../lib/errors/app-error'
import { isBlockedEitherWay } from '../blocks/blocks.repository'
import {
  clearFollowNotifications,
  notifyFromActor,
} from '../notifications/notifications.service'
import { findUserById } from '../users/users.repository'
import {
  acceptFollow,
  createFollow,
  deleteFollow,
  findFollow,
  findFollowers,
  findFollowing,
  findPendingRequests,
} from './follows.repository'

export async function followUser(followerId: string, followingId: string) {
  if (followerId === followingId) {
    throw new AppError(400, 'SELF_FOLLOW')
  }

  // Bloqueio em qualquer direção impede o follow. Mensagem genérica para não
  // revelar quem bloqueou quem.
  if (await isBlockedEitherWay(followerId, followingId)) {
    throw new AppError(403, 'FORBIDDEN')
  }

  const targetUser = await findUserById(followingId)
  if (!targetUser) {
    throw new AppError(404, 'USER_NOT_FOUND')
  }

  const existing = await findFollow(followerId, followingId)
  if (existing) {
    throw new AppError(
      409,
      existing.status === 'PENDING'
        ? 'FOLLOW_REQUEST_ALREADY_SENT'
        : 'ALREADY_FOLLOWING',
    )
  }

  const status = targetUser.isPrivate ? 'PENDING' : 'ACCEPTED'
  const follow = await createFollow(followerId, followingId, status)
  await notifyFromActor({
    recipientId: followingId,
    actorId: followerId,
    type: status === 'PENDING' ? 'FOLLOW_REQUEST' : 'NEW_FOLLOWER',
  })
  return follow
}

export async function approveFollowRequest(
  ownerId: string,
  followerId: string,
) {
  const follow = await findFollow(followerId, ownerId)
  if (!follow) {
    throw new AppError(404, 'FOLLOW_REQUEST_NOT_FOUND')
  }
  if (follow.status !== 'PENDING') {
    throw new AppError(409, 'FOLLOW_REQUEST_PROCESSED')
  }
  const accepted = await acceptFollow(follow.id)
  await notifyFromActor({
    recipientId: follow.followerId,
    actorId: ownerId,
    type: 'FOLLOW_ACCEPTED',
  })
  return accepted
}

export async function rejectFollowRequest(ownerId: string, followerId: string) {
  const follow = await findFollow(followerId, ownerId)
  if (!follow) {
    throw new AppError(404, 'FOLLOW_REQUEST_NOT_FOUND')
  }
  if (follow.status !== 'PENDING') {
    throw new AppError(409, 'FOLLOW_REQUEST_PROCESSED')
  }
  const result = await deleteFollow(followerId, ownerId)
  await clearFollowNotifications(followerId, ownerId)
  return result
}

export async function removeFollower(ownerId: string, followerId: string) {
  const follow = await findFollow(followerId, ownerId)
  if (!follow) {
    throw new AppError(404, 'FOLLOWER_NOT_FOUND')
  }
  const result = await deleteFollow(followerId, ownerId)
  await clearFollowNotifications(followerId, ownerId)
  return result
}

export async function unfollowUser(followerId: string, followingId: string) {
  const follow = await findFollow(followerId, followingId)
  if (!follow) {
    throw new AppError(404, 'FOLLOW_NOT_FOUND')
  }
  const result = await deleteFollow(followerId, followingId)
  await clearFollowNotifications(followerId, followingId)
  return result
}

async function ensureCanViewFollowList(userId: string, requesterId: string) {
  const user = await findUserById(userId)
  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND')
  }

  if (!user.isPrivate || requesterId === userId) {
    return
  }

  const follow = await findFollow(requesterId, userId)
  if (follow?.status !== 'ACCEPTED') {
    throw new AppError(403, 'PRIVATE_PROFILE')
  }
}

export async function listFollowers(
  userId: string,
  requesterId: string,
  limit: number,
  cursor?: string,
) {
  await ensureCanViewFollowList(userId, requesterId)
  const rows = await findFollowers(userId, limit, cursor)
  const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null
  return { data: rows.map((r) => r.follower), nextCursor }
}

export async function listFollowing(
  userId: string,
  requesterId: string,
  limit: number,
  cursor?: string,
) {
  await ensureCanViewFollowList(userId, requesterId)
  const rows = await findFollowing(userId, limit, cursor)
  const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null
  return { data: rows.map((r) => r.following), nextCursor }
}

export async function listPendingRequests(
  userId: string,
  limit: number,
  cursor?: string,
) {
  const rows = await findPendingRequests(userId, limit, cursor)
  const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null
  return { data: rows.map((r) => r.follower), nextCursor }
}
