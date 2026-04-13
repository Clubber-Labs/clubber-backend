import type { FastifyReply, FastifyRequest } from 'fastify'
import type {
  FollowParam,
  FollowRequestParam,
  PaginationQuery,
} from './follows.schema'
import {
  approveFollowRequest,
  followUser,
  listFollowers,
  listFollowing,
  listPendingRequests,
  rejectFollowRequest,
  removeFollower,
  unfollowUser,
} from './follows.service'

export async function postFollow(request: FastifyRequest, reply: FastifyReply) {
  const { userId: followingId } = request.params as FollowParam
  const follow = await followUser(request.user.sub, followingId)
  const message =
    follow.status === 'PENDING' ? 'Solicitação enviada' : 'Seguindo com sucesso'
  return reply.status(201).send({ message, status: follow.status })
}

export async function deleteFollow(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { userId: followingId } = request.params as FollowParam
  await unfollowUser(request.user.sub, followingId)
  return reply.status(204).send()
}

export async function getFollowers(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { userId } = request.params as FollowParam
  const { limit, cursor } = request.query as PaginationQuery
  const result = await listFollowers(userId, request.user.sub, limit, cursor)
  return reply.send(result)
}

export async function getFollowing(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { userId } = request.params as FollowParam
  const { limit, cursor } = request.query as PaginationQuery
  const result = await listFollowing(userId, request.user.sub, limit, cursor)
  return reply.send(result)
}

export async function deleteFollower(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { followerId } = request.params as FollowRequestParam
  await removeFollower(request.user.sub, followerId)
  return reply.status(204).send()
}

export async function getPendingRequests(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const requests = await listPendingRequests(request.user.sub)
  return reply.send(requests)
}

export async function postApproveFollow(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { followerId } = request.params as FollowRequestParam
  await approveFollowRequest(request.user.sub, followerId)
  return reply.status(204).send()
}

export async function postRejectFollow(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { followerId } = request.params as FollowRequestParam
  await rejectFollowRequest(request.user.sub, followerId)
  return reply.status(204).send()
}
