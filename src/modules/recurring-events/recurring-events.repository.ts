import { prisma } from '../../lib/prisma'
import type { OccurrenceContent, SeriesRule } from './recurring-events.schema'

export async function findAuthorPremium(authorId: string) {
  return prisma.user.findUnique({
    where: { id: authorId },
    select: { isPremium: true },
  })
}

// Cria a série (com o TEMPLATE de conteúdo) + todas as ocorrências numa
// transação. A primeira é criada com `create` (retorna o registro completo,
// contrato de POST /events); as demais via `createMany` com `skipDuplicates`
// (idempotente contra o unique (seriesId, date)). occurrences[0] é a inicial.
export async function createSeriesWithOccurrences(params: {
  rule: SeriesRule
  content: OccurrenceContent
  durationMs: number | null
  dates: { date: Date; endDate: Date | null }[]
}) {
  const { rule, content, durationMs, dates } = params
  return prisma.$transaction(async (tx) => {
    const series = await tx.eventSeries.create({
      data: {
        ...rule,
        // Template = conteúdo da série (o reconciler clona daqui).
        title: content.title,
        description: content.description,
        latitude: content.latitude,
        longitude: content.longitude,
        address: content.address,
        categories: content.categories,
        subcategories: content.subcategories,
        maxCapacity: content.maxCapacity,
        isPublic: content.isPublic,
        durationMs,
      },
    })
    const [first, ...rest] = dates
    const firstEvent = await tx.event.create({
      data: { ...content, seriesId: series.id, ...first },
    })
    if (rest.length > 0) {
      await tx.event.createMany({
        data: rest.map((d) => ({ ...content, seriesId: series.id, ...d })),
        skipDuplicates: true,
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
// Traz o TEMPLATE junto (o reconciler não faz query extra de conteúdo).
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
      title: true,
      description: true,
      latitude: true,
      longitude: true,
      address: true,
      categories: true,
      subcategories: true,
      maxCapacity: true,
      isPublic: true,
      durationMs: true,
    },
  })
}

export type SeriesOccurrenceBounds = {
  start: Date | null
  latest: Date | null
  total: number
}

// Âncora (1ª data), última data e total de ocorrências, em UMA query para
// todas as séries (evita N+1 no reconciler).
export async function getSeriesOccurrenceBoundsBatch(
  seriesIds: string[],
): Promise<Map<string, SeriesOccurrenceBounds>> {
  const map = new Map<string, SeriesOccurrenceBounds>()
  if (seriesIds.length === 0) return map

  const rows = await prisma.event.groupBy({
    by: ['seriesId'],
    where: { seriesId: { in: seriesIds } },
    _min: { date: true },
    _max: { date: true },
    _count: { _all: true },
  })
  for (const r of rows) {
    if (r.seriesId === null) continue
    map.set(r.seriesId, {
      start: r._min.date,
      latest: r._max.date,
      total: r._count._all,
    })
  }
  return map
}

export async function appendOccurrences(
  data: (OccurrenceContent & {
    seriesId: string
    date: Date
    endDate: Date | null
  })[],
) {
  if (data.length === 0) return 0
  // skipDuplicates: idempotente contra o unique (seriesId, date) — reconcilers
  // concorrentes não inserem ocorrências duplicadas.
  const result = await prisma.event.createMany({ data, skipDuplicates: true })
  return result.count
}
