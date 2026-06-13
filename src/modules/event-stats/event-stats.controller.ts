import type { FastifyReply, FastifyRequest } from 'fastify'
import type { EventStatsParams, EventStatsQuery } from './event-stats.schema'
import {
  exportEventStatsCsv,
  getEventStats,
  trackEventAnalyticsMetric,
} from './event-stats.service'

export async function getEventStatsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as EventStatsParams
  const { refresh } = request.query as EventStatsQuery
  const stats = await getEventStats(id, request.user.sub, { refresh })
  return reply.send(stats)
}

export async function exportStatsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as EventStatsParams
  const csv = await exportEventStatsCsv(id, request.user.sub)
  return reply
    .header('Content-Type', 'text/csv; charset=utf-8')
    .header(
      'Content-Disposition',
      `attachment; filename="event-${id}-stats.csv"`,
    )
    .send(csv)
}

export async function trackViewHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as EventStatsParams
  await trackEventAnalyticsMetric(id, request.user.sub, 'VIEW')
  return reply.status(204).send()
}

export async function trackShareHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as EventStatsParams
  await trackEventAnalyticsMetric(id, request.user.sub, 'SHARE')
  return reply.status(204).send()
}
