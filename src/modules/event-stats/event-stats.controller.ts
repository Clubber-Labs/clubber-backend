import type { FastifyReply, FastifyRequest } from 'fastify'
import type { EventStatsParams } from './event-stats.schema'
import { getEventStats } from './event-stats.service'

export async function getEventStatsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as EventStatsParams
  const stats = await getEventStats(id, request.user.sub)
  return reply.send(stats)
}
