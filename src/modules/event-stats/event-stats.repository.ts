import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'

export async function findEventForStats(eventId: string) {
  return prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      authorId: true,
      author: { select: { isPremium: true } },
    },
  })
}

export async function countAttendanceByType(eventId: string) {
  return prisma.eventAttendance.groupBy({
    by: ['type'],
    where: { eventId },
    _count: { _all: true },
  })
}

export async function createEventAnalyticsMetric(
  eventId: string,
  type: 'VIEW' | 'SHARE',
  occurredAt: Date,
) {
  return prisma.eventAnalyticsMetric.create({
    data: { eventId, type, occurredAt },
  })
}

export async function countAnalyticsMetricByType(eventId: string) {
  return prisma.eventAnalyticsMetric.groupBy({
    by: ['type'],
    where: { eventId },
    _count: { _all: true },
  })
}

export type EventStatsTimelineRow = {
  day: Date
  metric: 'VIEW' | 'SHARE' | 'CONFIRMED'
  count: number
}

export async function findEventStatsTimeline(eventId: string) {
  return prisma.$queryRaw<EventStatsTimelineRow[]>(Prisma.sql`
    SELECT day, metric, count FROM (
      SELECT
        DATE_TRUNC('day', m."occurredAt")::date AS day,
        m.type::text AS metric,
        COUNT(*)::int AS count
      FROM event_analytics_metrics m
      WHERE m."eventId" = ${eventId}
      GROUP BY 1, 2

      UNION ALL

      SELECT
        DATE_TRUNC('day', a."createdAt")::date AS day,
        'CONFIRMED' AS metric,
        COUNT(*)::int AS count
      FROM event_attendances a
      WHERE a."eventId" = ${eventId}
        AND a.type = 'CONFIRMED'
      GROUP BY 1, 2
    ) sub
    ORDER BY day ASC
  `)
}
