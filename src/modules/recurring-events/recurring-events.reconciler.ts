import { cache } from '../../lib/cache'
import { logger } from '../../lib/logger'
import { buildOccurrenceDates, RECURRENCE_MAX_OCCURRENCES } from './recurrence'
import {
  appendOccurrences,
  findLatestOccurrenceContent,
  findReplenishableSeries,
  getSeriesOccurrenceBounds,
} from './recurring-events.repository'

const reconcilerLog = logger.child({ component: 'recurring-events-reconciler' })

// Repõe ocorrências futuras das séries rolling até o horizonte mover. Cada
// nova ocorrência é clonada da mais recente (edição propaga — documentado).
// `now` é injetável para testes determinísticos.
export async function reconcileRecurringSeries(now = new Date()) {
  const series = await findReplenishableSeries(now)
  let created = 0
  let touchedPublic = false

  for (const s of series) {
    const bounds = await getSeriesOccurrenceBounds(s.id)
    if (!bounds.start || !bounds.latest) continue
    if (bounds.total >= RECURRENCE_MAX_OCCURRENCES) continue

    const newDates = buildOccurrenceDates({
      start: bounds.start,
      frequency: s.frequency,
      interval: s.interval,
      now,
      until: s.until,
      count: s.count,
      after: bounds.latest,
    })
    if (newDates.length === 0) continue

    const template = await findLatestOccurrenceContent(s.id)
    if (!template) continue

    const durationMs = template.endDate
      ? template.endDate.getTime() - template.date.getTime()
      : null

    const count = await appendOccurrences(
      newDates.map((date) => ({
        title: template.title,
        description: template.description,
        latitude: template.latitude,
        longitude: template.longitude,
        address: template.address,
        category: template.category,
        isPublic: template.isPublic,
        maxCapacity: template.maxCapacity,
        authorId: s.authorId,
        seriesId: s.id,
        date,
        endDate:
          durationMs === null ? null : new Date(date.getTime() + durationMs),
      })),
    )
    created += count
    if (count > 0 && template.isPublic) touchedPublic = true
  }

  if (touchedPublic) await cache.invalidate('events:public:*')
  return { created }
}

let timer: NodeJS.Timeout | null = null
let isReconciling = false

export function startRecurringEventsReconciler(intervalMs: number) {
  reconcilerLog.info({ intervalMs }, 'Starting recurring events reconciler')
  if (timer) return
  timer = setInterval(() => {
    if (isReconciling) return
    isReconciling = true
    reconcileRecurringSeries()
      .catch((err) => {
        reconcilerLog.error({ err }, 'recurring-events reconciliation failed')
      })
      .finally(() => {
        isReconciling = false
      })
  }, intervalMs)
  timer.unref?.()
}

export function stopRecurringEventsReconciler() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
