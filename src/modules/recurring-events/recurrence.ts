// Horizonte rolante: quantos dias à frente materializamos ocorrências por vez.
// O reconciler repõe conforme o tempo avança e séries sem `until` continuam.
export const RECURRENCE_HORIZON_DAYS = 90

// Teto absoluto de ocorrências por série (anti-abuso) — vale para criação e
// reposição. 52 ≈ um ano de série semanal.
export const RECURRENCE_MAX_OCCURRENCES = 52

const MS_PER_DAY = 86_400_000

export type RecurrenceFrequency = 'WEEKLY' | 'MONTHLY'

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY)
}

// Soma meses em UTC preservando hora/minuto e fazendo CLAMP do dia para o
// último dia do mês de destino (31 jan -> 28/29 fev). Tudo em UTC: o horário
// local pode deslocar em mudanças de fuso/DST (limitação documentada do v1).
function addMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear()
  const targetMonth = date.getUTCMonth() + months
  const lastDayOfTarget = new Date(
    Date.UTC(year, targetMonth + 1, 0),
  ).getUTCDate()
  const day = Math.min(date.getUTCDate(), lastDayOfTarget)
  return new Date(
    Date.UTC(
      year,
      targetMonth,
      day,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  )
}

// Próxima ocorrência a partir de UMA data (passo único).
export function nextOccurrenceDate(
  date: Date,
  frequency: RecurrenceFrequency,
  interval: number,
): Date {
  return frequency === 'WEEKLY'
    ? addDays(date, 7 * interval)
    : addMonths(date, interval)
}

// i-ésima ocorrência ancorada na data inicial (i=0 é a própria inicial).
// Ancorar no início evita o drift do MONTHLY: "todo dia 31" volta a ser 31
// nos meses longos mesmo após um fev clampado.
function occurrenceAt(
  start: Date,
  frequency: RecurrenceFrequency,
  interval: number,
  index: number,
): Date {
  return frequency === 'WEEKLY'
    ? addDays(start, 7 * interval * index)
    : addMonths(start, interval * index)
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
    const occurrence = occurrenceAt(start, frequency, interval, i)
    if (occurrence.getTime() > end.getTime()) break
    dates.push(occurrence)
  }

  if (after) {
    const cutoff = after.getTime()
    return dates.filter((d) => d.getTime() > cutoff)
  }
  return dates
}
