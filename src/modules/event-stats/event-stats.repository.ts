import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'

// Inclui os _count de engajamento no mesmo SELECT da autorização: evita uma
// segunda query para a mesma row e fecha a janela TOCTOU (o evento poderia ser
// deletado entre a checagem de existência e um findUniqueOrThrow → P2025/500).
export async function findEventForStats(eventId: string) {
  return prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      authorId: true,
      author: { select: { isPremium: true } },
      _count: {
        select: { reactions: true, comments: true, posts: true, invites: true },
      },
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

export type AttendanceTimelineRow = {
  day: Date
  type: 'INTERESTED' | 'CONFIRMED'
  count: number
}

// Coberto por @@index([eventId, createdAt]) de event_attendances.
export async function findAttendanceTimeline(eventId: string) {
  return prisma.$queryRaw<AttendanceTimelineRow[]>(Prisma.sql`
    SELECT
      DATE_TRUNC('day', a."createdAt")::date AS day,
      a.type::text AS type,
      COUNT(*)::int AS count
    FROM event_attendances a
    WHERE a."eventId" = ${eventId}
      AND a.type IN ('INTERESTED', 'CONFIRMED')
    GROUP BY 1, 2
    ORDER BY 1
  `)
}
