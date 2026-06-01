import type { FastifyReply, FastifyRequest } from 'fastify'
import type {
  BlockListQuery,
  BlockParam,
  CreateBlockBody,
} from './blocks.schema'
import { blockUser, listBlockedUsers, unblockUser } from './blocks.service'

export async function postBlock(request: FastifyRequest, reply: FastifyReply) {
  const { userId } = request.body as CreateBlockBody
  const block = await blockUser(request.user.sub, userId)
  return reply.status(201).send(block)
}

export async function deleteBlockHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { userId } = request.params as BlockParam
  await unblockUser(request.user.sub, userId)
  return reply.status(204).send()
}

export async function getBlocks(request: FastifyRequest, reply: FastifyReply) {
  const { limit, cursor } = request.query as BlockListQuery
  const result = await listBlockedUsers(request.user.sub, limit, cursor)
  return reply.send(result)
}
