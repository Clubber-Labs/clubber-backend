import type { FastifyReply, FastifyRequest } from 'fastify'
import type { FeedQuery } from './feed.schema'
import { getFeed } from './feed.service'

export async function getMainFeed(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const result = await getFeed(request.user.sub, request.query as FeedQuery)
  request.log.info(
    { userId: request.user.sub, requestQuery: request.query },
    'User requested main feed',
  )
  return reply.send(result)
}
