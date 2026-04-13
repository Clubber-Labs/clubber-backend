import { findUserById } from '../users/users.repository'
import {
  acceptFollowRequest,
  createFollow,
  deleteFollow,
  findFollow,
  findFollowers,
  findFollowing,
  findPendingFollowRequests,
} from './follows.repository'

export async function followUser(followerId: string, followingId: string) {
  if (followerId === followingId) {
    throw { statusCode: 400, message: 'Você não pode seguir a si mesmo' }
  }

  const targetUser = await findUserById(followingId)
  if (!targetUser) {
    throw { statusCode: 404, message: 'Usuário não encontrado' }
  }

  const existing = await findFollow(followerId, followingId)
  if (existing) {
    const message =
      existing.status === 'PENDING'
        ? 'Solicitação de follow já enviada'
        : 'Você já segue este usuário'
    throw { statusCode: 409, message }
  }

  const status = targetUser.isPrivate ? 'PENDING' : 'ACCEPTED'

  return createFollow(followerId, followingId, status)
}

export async function approveFollowRequest(
  ownerId: string,
  followerId: string,
) {
  const follow = await findFollow(followerId, ownerId)
  if (!follow) {
    throw { statusCode: 404, message: 'Solicitação não encontrada' }
  }
  if (follow.status !== 'PENDING') {
    throw { statusCode: 409, message: 'Solicitação já foi processada' }
  }

  return acceptFollowRequest(follow.id)
}

export async function rejectFollowRequest(ownerId: string, followerId: string) {
  const follow = await findFollow(followerId, ownerId)
  if (!follow) {
    throw { statusCode: 404, message: 'Solicitação não encontrada' }
  }
  if (follow.status !== 'PENDING') {
    throw { statusCode: 409, message: 'Solicitação já foi processada' }
  }

  return deleteFollow(followerId, ownerId)
}

export async function unfollowUser(followerId: string, followingId: string) {
  const follow = await findFollow(followerId, followingId)
  if (!follow) {
    throw { statusCode: 404, message: 'Você não segue este usuário' }
  }

  return deleteFollow(followerId, followingId)
}

async function ensureCanViewFollowList(userId: string, requesterId?: string) {
  const user = await findUserById(userId)
  if (!user) {
    throw { statusCode: 404, message: 'Usuário não encontrado' }
  }

  if (!user.isPrivate || requesterId === userId) {
    return user
  }

  if (!requesterId) {
    throw { statusCode: 403, message: 'Perfil privado' }
  }

  const follow = await findFollow(requesterId, userId)
  if (follow?.status === 'ACCEPTED') {
    return user
  }

  throw { statusCode: 403, message: 'Perfil privado' }
}

export async function listFollowers(
  userId: string,
  requesterId?: string,
  limit?: number,
  cursor?: string,
) {
  await ensureCanViewFollowList(userId, requesterId)
  const followers = await findFollowers(userId, limit, cursor)
  return followers.map((f) => f.follower)
}

export async function listFollowing(
  userId: string,
  requesterId?: string,
  limit?: number,
  cursor?: string,
) {
  await ensureCanViewFollowList(userId, requesterId)
  const following = await findFollowing(userId, limit, cursor)
  return following.map((f) => f.following)
}

export async function listPendingFollowRequests(userId: string) {
  const requests = await findPendingFollowRequests(userId)
  return requests.map((f) => f.follower)
}
