import { cache } from '../../lib/cache'
import {
  type AttendanceTimelineRow,
  countAttendanceByType,
  findAttendanceTimeline,
  findEventForStats,
} from './event-stats.repository'
import type { EventStats, EventStatsTimelinePoint } from './event-stats.schema'

const STATS_CACHE_TTL_SECONDS = 60

function toIsoDay(day: Date): string {
  return day.toISOString().slice(0, 10)
}

function pivotTimeline(
  rows: AttendanceTimelineRow[],
): EventStatsTimelinePoint[] {
  const byDay = new Map<string, EventStatsTimelinePoint>()
  for (const row of rows) {
    const date = toIsoDay(row.day)
    const point = byDay.get(date) ?? { date, interested: 0, confirmed: 0 }
    if (row.type === 'INTERESTED') point.interested = row.count
    else point.confirmed = row.count
    byDay.set(date, point)
  }
  // rows já chegam ordenadas por dia ASC; Map preserva ordem de inserção.
  return [...byDay.values()]
}

export async function getEventStats(
  eventId: string,
  requesterId: string,
): Promise<EventStats> {
  const event = await findEventForStats(eventId)
  if (!event) throw { statusCode: 404, message: 'Evento não encontrado' }

  if (event.authorId !== requesterId) {
    throw {
      statusCode: 403,
      message: 'Apenas o autor do evento pode ver as estatísticas',
    }
  }

  // requirePremium na rota já barra requester não-premium; aqui cobre a race
  // entre downgrade e o GET, igual ao padrão de featured-events.service.
  if (!event.author.isPremium) {
    throw {
      statusCode: 403,
      message: 'Estatísticas são exclusivas para usuários Premium',
    }
  }

  // Cache lido DEPOIS das checagens de 404/403: a key é só por evento, então
  // a autorização nunca pode vir do cache. TTL-only (sem invalidação) — até
  // 60s de staleness é aceitável para dashboard e evita acoplar attendance/
  // reactions/comments/posts/invites a este módulo.
  const cacheKey = cache.key('event-stats', eventId)
  const cached = await cache.get<EventStats>(cacheKey)
  if (cached) return cached

  // _count de engajamento já veio em findEventForStats (uma query a menos,
  // sem TOCTOU). Falta só agregar attendances e a timeline.
  const engagement = event._count
  const [attendanceGroups, timelineRows] = await Promise.all([
    countAttendanceByType(eventId),
    findAttendanceTimeline(eventId),
  ])

  const byType = { INTERESTED: 0, CONFIRMED: 0, NOT_INTERESTED: 0 }
  for (const group of attendanceGroups) {
    byType[group.type] = group._count._all
  }

  const base = byType.INTERESTED + byType.CONFIRMED
  const confirmationRate = base === 0 ? null : byType.CONFIRMED / base

  const stats: EventStats = {
    eventId,
    totals: {
      interested: byType.INTERESTED,
      confirmed: byType.CONFIRMED,
      notInterested: byType.NOT_INTERESTED,
      reactions: engagement.reactions,
      comments: engagement.comments,
      posts: engagement.posts,
      invitesSent: engagement.invites,
    },
    confirmationRate,
    timeline: pivotTimeline(timelineRows),
  }

  await cache.set(cacheKey, stats, STATS_CACHE_TTL_SECONDS)
  return stats
}
