import { z } from 'zod'

export const eventStatsParamsSchema = z.object({
  id: z.uuid(),
})

export type EventStatsParams = z.infer<typeof eventStatsParamsSchema>

export const eventStatsQuerySchema = z.object({
  refresh: z
    .union([z.boolean(), z.literal('true'), z.literal('false')])
    .optional()
    .transform((value) => value === true || value === 'true'),
})

export type EventStatsQuery = z.infer<typeof eventStatsQuerySchema>

export const eventAnalyticsTrackBodySchema = z.object({})

export const eventStatsTotalsSchema = z.object({
  views: z.number().int(),
  shares: z.number().int(),
  confirmations: z.number().int(),
})

// Delta diário (não cumulativo); dias sem registro são omitidos.
export const eventStatsTimelinePointSchema = z.object({
  date: z.string(),
  views: z.number().int(),
  shares: z.number().int(),
  confirmations: z.number().int(),
})

export const eventStatsSchema = z.object({
  eventId: z.uuid(),
  updatedAt: z.string().datetime(),
  totals: eventStatsTotalsSchema,
  timeline: z.array(eventStatsTimelinePointSchema),
})

export type EventStatsTotals = z.infer<typeof eventStatsTotalsSchema>
export type EventStatsTimelinePoint = z.infer<
  typeof eventStatsTimelinePointSchema
>
export type EventStats = z.infer<typeof eventStatsSchema>
