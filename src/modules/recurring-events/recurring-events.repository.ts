import type { EventCategory, RecurrenceFrequency } from '@prisma/client'
import { prisma } from '../../lib/prisma'

// Conteúdo replicado em cada ocorrência (sem date/endDate, que variam).
export type OccurrenceContent = {
  title: string
  description: string | null
  latitude: number
  longitude: number
  address: string | null
  category: EventCategory
  isPublic: boolean
  maxCapacity: number | null
  authorId: string
}

export type SeriesRule = {
  frequency: RecurrenceFrequency
  interval: number
  until: Date | null
  count: number | null
  authorId: string
}

export async function findAuthorPremium(authorId: string) {
  return prisma.user.findUnique({
    where: { id: authorId },
    select: { isPremium: true },
  })
}

// Cria a série + todas as ocorrências numa transação. A primeira é criada com
// `create` (para retornar o registro completo, contrato de POST /events); as
// demais via `createMany`. occurrences[0] é a inicial.
export async function createSeriesWithOccurrences(params: {
  rule: SeriesRule
  content: OccurrenceContent
  dates: { date: Date; endDate: Date | null }[]
}) {
  const { rule, content, dates } = params
  return prisma.$transaction(async (tx) => {
    const series = await tx.eventSeries.create({ data: rule })
    const [first, ...rest] = dates
    const firstEvent = await tx.event.create({
      data: { ...content, seriesId: series.id, ...first },
    })
    if (rest.length > 0) {
      await tx.event.createMany({
        data: rest.map((d) => ({ ...content, seriesId: series.id, ...d })),
      })
    }
    return firstEvent
  })
}

export async function findSeriesById(seriesId: string) {
  return prisma.eventSeries.findUnique({
    where: { id: seriesId },
    select: { id: true, authorId: true, canceledAt: true },
  })
}

// Cancela a série e as ocorrências FUTURAS não-canceladas (passadas/em curso
// ficam intactas), numa transação.
export async function cancelSeries(seriesId: string) {
  const now = new Date()
  return prisma.$transaction(async (tx) => {
    await tx.eventSeries.update({
      where: { id: seriesId },
      data: { canceledAt: now },
    })
    await tx.event.updateMany({
      where: { seriesId, canceledAt: null, date: { gt: now } },
      data: { canceledAt: now },
    })
  })
}

// Séries vivas elegíveis a reposição: não canceladas, dentro do `until`, de
// autor premium (downgrade pausa a reposição — risco documentado no plano).
export async function findReplenishableSeries(now: Date) {
  return prisma.eventSeries.findMany({
    where: {
      canceledAt: null,
      OR: [{ until: null }, { until: { gt: now } }],
      author: { isPremium: true },
    },
    select: {
      id: true,
      frequency: true,
      interval: true,
      until: true,
      count: true,
      authorId: true,
    },
  })
}

// Âncora (1ª data), última data e total de ocorrências de uma série.
export async function getSeriesOccurrenceBounds(seriesId: string) {
  const agg = await prisma.event.aggregate({
    where: { seriesId },
    _min: { date: true },
    _max: { date: true },
    _count: { _all: true },
  })
  return {
    start: agg._min.date,
    latest: agg._max.date,
    total: agg._count._all,
  }
}

// Conteúdo da ocorrência mais recente — usado como template das próximas
// (edição numa ocorrência propaga para as geradas; comportamento documentado).
export async function findLatestOccurrenceContent(seriesId: string) {
  return prisma.event.findFirst({
    where: { seriesId },
    orderBy: { date: 'desc' },
    select: {
      title: true,
      description: true,
      latitude: true,
      longitude: true,
      address: true,
      category: true,
      isPublic: true,
      maxCapacity: true,
      date: true,
      endDate: true,
    },
  })
}

export async function appendOccurrences(
  data: (OccurrenceContent & {
    seriesId: string
    date: Date
    endDate: Date | null
  })[],
) {
  if (data.length === 0) return 0
  const result = await prisma.event.createMany({ data })
  return result.count
}
