import { cache } from '../../lib/cache'
import { ensureEventAccess } from '../event-invites/event-invites.access'
import {
  countAnalyticsMetricByType,
  countAttendanceByType,
  createEventAnalyticsMetric,
  type EventStatsTimelineRow,
  findEventForStats,
  findEventStatsTimeline,
} from './event-stats.repository'
import type { EventStats, EventStatsTimelinePoint } from './event-stats.schema'

const STATS_CACHE_TTL_SECONDS = 15 * 60

function toIsoDay(day: Date): string {
  return day.toISOString().slice(0, 10)
}

function statsCacheKey(eventId: string) {
  return cache.key('event-stats', eventId)
}

function pivotTimeline(
  rows: EventStatsTimelineRow[],
): EventStatsTimelinePoint[] {
  const byDay = new Map<string, EventStatsTimelinePoint>()
  for (const row of rows) {
    const date = toIsoDay(row.day)
    const point = byDay.get(date) ?? {
      date,
      views: 0,
      shares: 0,
      confirmations: 0,
    }
    if (row.metric === 'VIEW') point.views = row.count
    else if (row.metric === 'SHARE') point.shares = row.count
    else point.confirmations = row.count
    byDay.set(date, point)
  }
  // rows já chegam ordenadas por dia ASC; Map preserva ordem de inserção.
  return [...byDay.values()]
}

export async function getEventStats(
  eventId: string,
  requesterId: string,
  options: { refresh?: boolean } = {},
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
  // a autorização nunca pode vir do cache. O TCC aceita atualização a cada
  // 15min ou por botão manual; refresh=true força recomputar.
  const cacheKey = statsCacheKey(eventId)
  if (!options.refresh) {
    const cached = await cache.get<EventStats>(cacheKey)
    if (cached) return cached
  }

  const [analyticsGroups, attendanceGroups, timelineRows] = await Promise.all([
    countAnalyticsMetricByType(eventId),
    countAttendanceByType(eventId),
    findEventStatsTimeline(eventId),
  ])

  const analyticsByType = { VIEW: 0, SHARE: 0 }
  for (const group of analyticsGroups) {
    analyticsByType[group.type] = group._count._all
  }

  let confirmations = 0
  for (const group of attendanceGroups) {
    if (group.type === 'CONFIRMED') confirmations = group._count._all
  }

  const stats: EventStats = {
    eventId,
    updatedAt: new Date().toISOString(),
    totals: {
      views: analyticsByType.VIEW,
      shares: analyticsByType.SHARE,
      confirmations,
    },
    timeline: pivotTimeline(timelineRows),
  }

  await cache.set(cacheKey, stats, STATS_CACHE_TTL_SECONDS)
  return stats
}

export async function trackEventAnalyticsMetric(
  eventId: string,
  requesterId: string,
  type: 'VIEW' | 'SHARE',
) {
  await ensureEventAccess(eventId, requesterId)
  await createEventAnalyticsMetric(eventId, type, new Date())
}

export async function exportEventStatsCsv(
  eventId: string,
  requesterId: string,
) {
  const stats = await getEventStats(eventId, requesterId, { refresh: true })
  const rows = [
    ['data', 'visualizacoes', 'compartilhamentos', 'confirmacoes'],
    ...stats.timeline.map((point) => [
      point.date,
      String(point.views),
      String(point.shares),
      String(point.confirmations),
    ]),
  ]
  return rows.map((row) => row.join(',')).join('\n')
}
