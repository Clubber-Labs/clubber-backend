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
  return acceptFollow(follow.id)
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

export async function removeFollower(ownerId: string, followerId: string) {
  const follow = await findFollow(followerId, ownerId)
  if (!follow) {
    throw { statusCode: 404, message: 'Seguidor não encontrado' }
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

async function ensureCanViewFollowList(userId: string, requesterId: string) {
  const user = await findUserById(userId)
  if (!user) {
    throw { statusCode: 404, message: 'Usuário não encontrado' }
  }

  if (!user.isPrivate || requesterId === userId) {
    return
  }

  const follow = await findFollow(requesterId, userId)
  if (follow?.status !== 'ACCEPTED') {
    throw { statusCode: 403, message: 'Perfil privado' }
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

export async function listPendingRequests(userId: string) {
  const rows = await findPendingRequests(userId)
  return rows.map((r) => r.follower)
}
