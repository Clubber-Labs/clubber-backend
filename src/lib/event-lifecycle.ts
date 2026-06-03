export const EVENT_STATUSES = [
  'CANCELED',
  'PAST',
  'ONGOING',
  'SOON',
  'UPCOMING',
] as const

export type EventStatus = (typeof EVENT_STATUSES)[number]

export const SOON_THRESHOLD_MS = 48 * 60 * 60 * 1000
export const DEFAULT_DURATION_MS = 4 * 60 * 60 * 1000

// Janela em que um evento PAST ainda aparece no mapa/busca antes de sumir.
export const RECENT_PAST_MS = 48 * 60 * 60 * 1000

export function resolveEndDate(date: Date, endDate: Date | null): Date {
  return endDate ?? new Date(date.getTime() + DEFAULT_DURATION_MS)
}

export function computeEventStatus(
  event: { date: Date; endDate: Date | null; canceledAt: Date | null },
  now: Date = new Date(),
): EventStatus {
  if (event.canceledAt) return 'CANCELED'

  const start = event.date.getTime()
  const end = resolveEndDate(event.date, event.endDate).getTime()
  const t = now.getTime()

  if (t >= end) return 'PAST'
  if (t >= start) return 'ONGOING'
  if (start - t <= SOON_THRESHOLD_MS) return 'SOON'
  return 'UPCOMING'
}
