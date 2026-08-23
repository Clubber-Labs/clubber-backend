import { DateTime } from 'luxon'

// Horizonte rolante: quantos dias à frente materializamos ocorrências por vez.
// O reconciler repõe conforme o tempo avança e séries sem `until` continuam.
export const RECURRENCE_HORIZON_DAYS = 90

// Teto absoluto de ocorrências por série (anti-abuso) — vale para criação e
// reposição. 52 ≈ um ano de série semanal.
export const RECURRENCE_MAX_OCCURRENCES = 52

const MS_PER_DAY = 86_400_000

export type RecurrenceFrequency = 'WEEKLY' | 'MONTHLY'

/**
 * Avança na ZONA da série, não em UTC: um evento acontece "às 22h naquele
 * lugar". Somar em UTC atravessa o DST deslocando a hora de parede (22h vira
 * 21h ou 23h). Séries antigas, sem fuso gravado, seguem em UTC.
 *
 * O clamp de fim de mês (31 jan → 28/29 fev) é o mesmo de antes — é como o
 * luxon resolve `plus({ months })`.
 */
function shift(
  date: Date,
  frequency: RecurrenceFrequency,
  steps: number,
  timeZone: string | null | undefined,
): Date {
  const start = DateTime.fromJSDate(date, { zone: timeZone ?? 'utc' })
  const moved =
    frequency === 'WEEKLY'
      ? start.plus({ weeks: steps })
      : start.plus({ months: steps })
  return moved.toJSDate()
}

// Próxima ocorrência a partir de UMA data (passo único).
export function nextOccurrenceDate(
  date: Date,
  frequency: RecurrenceFrequency,
  interval: number,
  timeZone?: string | null,
): Date {
  return shift(date, frequency, interval, timeZone)
}

type BuildParams = {
  start: Date
  frequency: RecurrenceFrequency
  interval: number
  now: Date
  until?: Date | null
  count?: number | null
  // Reposição: retorna só ocorrências estritamente depois deste ponto.
  after?: Date | null
  /** IANA do local do evento. Ausente = série antiga, computada em UTC. */
  timeZone?: string | null
}

// Materializa as datas de ocorrência respeitando, em conjunto: horizonte
// rolante (now + 90d), `until`, `count` e o cap absoluto. Ancoradas em `start`,
// então as já existentes são sempre um prefixo — `after` filtra o sufixo novo.
export function buildOccurrenceDates({
  start,
  frequency,
  interval,
  now,
  until,
  count,
  after,
  timeZone,
}: BuildParams): Date[] {
  const horizonEnd = new Date(
    now.getTime() + RECURRENCE_HORIZON_DAYS * MS_PER_DAY,
  )
  const end =
    until && until.getTime() < horizonEnd.getTime() ? until : horizonEnd
  const maxCount = Math.min(
    count ?? RECURRENCE_MAX_OCCURRENCES,
    RECURRENCE_MAX_OCCURRENCES,
  )

  const dates: Date[] = []
  for (let i = 0; dates.length < maxCount; i++) {
    // Ancorada em `start` (não na anterior): evita o drift do MONTHLY — "todo
    // dia 31" volta a ser 31 nos meses longos mesmo após um fev clampado.
    const occurrence = shift(start, frequency, interval * i, timeZone)
    if (occurrence.getTime() > end.getTime()) break
    dates.push(occurrence)
  }

  if (after) {
    const cutoff = after.getTime()
    return dates.filter((d) => d.getTime() > cutoff)
  }
  return dates
}
