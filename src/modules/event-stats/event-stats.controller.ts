import type { FastifyReply, FastifyRequest } from 'fastify'
import type { EventStatsParams, EventStatsQuery } from './event-stats.schema'
import {
  exportEventStatsCsv,
  getEventStats,
  trackEventAnalyticsMetric,
} from './event-stats.service'

export async function getEventStatsHandler(
  request: FastifyRequest<{
    Params: EventStatsParams
    Querystring: EventStatsQuery
  }>,
  reply: FastifyReply,
) {
  const stats = await getEventStats(request.params.id, request.user.sub, {
    refresh: request.query.refresh,
  })
  return reply.send(stats)
}

export async function exportStatsHandler(
  request: FastifyRequest<{ Params: EventStatsParams }>,
  reply: FastifyReply,
) {
  const csv = await exportEventStatsCsv(request.params.id, request.user.sub)
  return reply
    .header('Content-Type', 'text/csv; charset=utf-8')
    .header(
      'Content-Disposition',
      `attachment; filename="event-${request.params.id}-stats.csv"`,
    )
    .send(csv)
}

export async function trackViewHandler(
  request: FastifyRequest<{ Params: EventStatsParams }>,
  reply: FastifyReply,
) {
  await trackEventAnalyticsMetric(request.params.id, request.user.sub, 'VIEW')
  return reply.status(204).send()
}

export async function trackShareHandler(
  request: FastifyRequest<{ Params: EventStatsParams }>,
  reply: FastifyReply,
) {
  await trackEventAnalyticsMetric(request.params.id, request.user.sub, 'SHARE')
  return reply.status(204).send()
}
