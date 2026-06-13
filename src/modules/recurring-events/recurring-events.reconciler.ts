import { cache } from '../../lib/cache'
import { logger } from '../../lib/logger'
import { buildOccurrenceDates, RECURRENCE_MAX_OCCURRENCES } from './recurrence'
import {
  appendOccurrences,
  findReplenishableSeries,
  getSeriesOccurrenceBoundsBatch,
} from './recurring-events.repository'
import type { OccurrenceContent } from './recurring-events.schema'

const reconcilerLog = logger.child({ component: 'recurring-events-reconciler' })

type OccurrenceRow = OccurrenceContent & {
  seriesId: string
  date: Date
  endDate: Date | null
}

// Repõe ocorrências futuras das séries rolling até o horizonte mover. Clona do
// TEMPLATE DA SÉRIE (não da última ocorrência), então editar uma ocorrência
// individual não propaga para as geradas. Faz 3 queries no total
// (séries + bounds em lote + um createMany), sem N+1. `now` é injetável.
export async function reconcileRecurringSeries(now = new Date()) {
  const series = await findReplenishableSeries(now)
  if (series.length === 0) return { created: 0 }

  const boundsMap = await getSeriesOccurrenceBoundsBatch(
    series.map((s) => s.id),
  )
  const rows: OccurrenceRow[] = []
  let touchedPublic = false

  for (const s of series) {
    // Série sem template (legado/pré-migration): pula a reposição.
    if (
      s.title === null ||
      s.latitude === null ||
      s.longitude === null ||
      s.categories.length === 0
    ) {
      continue
    }

    const bounds = boundsMap.get(s.id)
    if (!bounds?.start || !bounds.latest) continue
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

    const durationMs = s.durationMs
    for (const date of newDates) {
      rows.push({
        title: s.title,
        description: s.description,
        latitude: s.latitude,
        longitude: s.longitude,
        address: s.address,
        categories: s.categories,
        isPublic: s.isPublic,
        maxCapacity: s.maxCapacity,
        authorId: s.authorId,
        seriesId: s.id,
        date,
        endDate:
          durationMs === null ? null : new Date(date.getTime() + durationMs),
      })
    }
    if (s.isPublic) touchedPublic = true
  }

  const created = await appendOccurrences(rows)
  if (created > 0 && touchedPublic) await cache.invalidate('events:public:*')
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
