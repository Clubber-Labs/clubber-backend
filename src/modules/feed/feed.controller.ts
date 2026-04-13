import type { FastifyReply, FastifyRequest } from 'fastify'
import type { FeedQuery } from './feed.schema'
import { getFeed } from './feed.service'

export async function getMainFeed(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { limit, cursor } = request.query as FeedQuery
  const result = await getFeed(request.user.sub, limit, cursor)
  return reply.send(result)
}
