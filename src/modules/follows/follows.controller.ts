import type { FastifyReply, FastifyRequest } from 'fastify'
import type {
  FollowerIdParam,
  FollowUserIdParam,
  PaginationQuery,
} from './follows.schema'
import {
  approveFollowRequest,
  followUser,
  listFollowers,
  listFollowing,
  listPendingFollowRequests,
  rejectFollowRequest,
  unfollowUser,
} from './follows.service'

export async function postFollow(request: FastifyRequest, reply: FastifyReply) {
  const { userId } = request.params as FollowUserIdParam
  const follow = await followUser(request.user.sub, userId)
  const message =
    follow.status === 'PENDING'
      ? 'Solicitação de follow enviada'
      : 'Seguindo com sucesso'
  return reply.status(201).send({ message, status: follow.status })
}

export async function deleteFollow(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { userId } = request.params as FollowUserIdParam
  await unfollowUser(request.user.sub, userId)
  return reply.status(204).send()
}

export async function getFollowers(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { userId } = request.params as FollowUserIdParam
  const { limit, cursor } = request.query as PaginationQuery
  const requesterId = request.user?.sub
  const followers = await listFollowers(userId, requesterId, limit, cursor)
  return reply.send(followers)
}

export async function getFollowing(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { userId } = request.params as FollowUserIdParam
  const { limit, cursor } = request.query as PaginationQuery
  const requesterId = request.user?.sub
  const following = await listFollowing(userId, requesterId, limit, cursor)
  return reply.send(following)
}

export async function getFollowRequests(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const requests = await listPendingFollowRequests(request.user.sub)
  return reply.send(requests)
}

export async function postApproveFollowRequest(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { followerId } = request.params as FollowerIdParam
  await approveFollowRequest(request.user.sub, followerId)
  return reply.send({ message: 'Solicitação aceita' })
}

export async function deleteFollowRequest(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { followerId } = request.params as FollowerIdParam
  await rejectFollowRequest(request.user.sub, followerId)
  return reply.status(204).send()
}
