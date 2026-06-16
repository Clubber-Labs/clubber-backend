import { cache } from '../../lib/cache'
import type { CreateEventBody } from '../events/events.schema'
import { enqueueEventCreated } from '../notifications/notification-queue'
import { buildOccurrenceDates } from './recurrence'
import {
  cancelSeries as cancelSeriesRepo,
  createSeriesWithOccurrences,
  findAuthorPremium,
  findSeriesById,
} from './recurring-events.repository'
import type {
  OccurrenceContent,
  RecurrenceInput,
} from './recurring-events.schema'

type EventData = Omit<CreateEventBody, 'recurrence'>

// Materializa uma série recorrente (RF11.6, premium). O gate premium aqui é o
// único possível — o hook não enxerga o corpo da request; equivale ao
// double-check do padrão featured-events.
export async function createRecurringEvent(
  data: EventData,
  recurrence: RecurrenceInput,
  authorId: string,
) {
  const author = await findAuthorPremium(authorId)
  if (!author?.isPremium) {
    throw {
      statusCode: 403,
      message: 'Eventos recorrentes são exclusivos para usuários Premium',
    }
  }

  const now = new Date()
  const dates = buildOccurrenceDates({
    start: data.date,
    frequency: recurrence.frequency,
    interval: recurrence.interval,
    now,
    until: recurrence.until ?? null,
    count: recurrence.count ?? null,
  })

  // Preserva a duração (endDate - date) em cada ocorrência; sem endDate, fica
  // null (o default SQL de +4h cobre na leitura).
  const durationMs = data.endDate
    ? data.endDate.getTime() - data.date.getTime()
    : null
  const occurrenceDates = dates.map((date) => ({
    date,
    endDate: durationMs === null ? null : new Date(date.getTime() + durationMs),
  }))

  const content: OccurrenceContent = {
    title: data.title,
    description: data.description ?? null,
    latitude: data.latitude,
    longitude: data.longitude,
    address: data.address ?? null,
    categories: data.categories,
    subcategories: data.subcategories ?? [],
    isPublic: data.isPublic,
    maxCapacity: data.maxCapacity ?? null,
    authorId,
  }

  const first = await createSeriesWithOccurrences({
    rule: {
      frequency: recurrence.frequency,
      interval: recurrence.interval,
      until: recurrence.until ?? null,
      count: recurrence.count ?? null,
      authorId,
    },
    content,
    durationMs,
    dates: occurrenceDates,
  })

  // Side-effects pós-commit (fora da transação). Fan-out de proximidade só da
  // PRIMEIRA ocorrência — N pushes EVENT_NEARBY da mesma série seria spam.
  if (data.isPublic === true) {
    await cache.invalidate('events:public:*')
    await enqueueEventCreated(first.id)
  }

  return first
}

export async function cancelSeries(seriesId: string, requesterId: string) {
  const series = await findSeriesById(seriesId)
  if (!series) throw { statusCode: 404, message: 'Série não encontrada' }

  if (series.authorId !== requesterId) {
    throw {
      statusCode: 403,
      message: 'Apenas o autor da série pode cancelá-la',
    }
  }

  if (series.canceledAt !== null) {
    throw { statusCode: 409, message: 'Série já cancelada' }
  }

  await cancelSeriesRepo(seriesId)
  await cache.invalidate('events:public:*')
}
