import { z } from 'zod'

export const eventStatsParamsSchema = z.object({
  id: z.uuid(),
})

export type EventStatsParams = z.infer<typeof eventStatsParamsSchema>

export const eventStatsTotalsSchema = z.object({
  interested: z.number().int(),
  confirmed: z.number().int(),
  notInterested: z.number().int(),
  reactions: z.number().int(),
  comments: z.number().int(),
  posts: z.number().int(),
  invitesSent: z.number().int(),
})

// Delta diário (não cumulativo); dias sem registro são omitidos. Como
// attendance é upsert (1 linha por user+evento), quem mudou de INTERESTED
// para CONFIRMED aparece uma única vez, no createdAt original, com o tipo
// atual — a timeline é um proxy de evolução, não um funil de transições.
export const eventStatsTimelinePointSchema = z.object({
  date: z.string(),
  interested: z.number().int(),
  confirmed: z.number().int(),
})

export const eventStatsSchema = z.object({
  eventId: z.uuid(),
  totals: eventStatsTotalsSchema,
  // confirmed / (interested + confirmed); null quando não há base.
  confirmationRate: z.number().nullable(),
  timeline: z.array(eventStatsTimelinePointSchema),
})

export type EventStatsTotals = z.infer<typeof eventStatsTotalsSchema>
export type EventStatsTimelinePoint = z.infer<
  typeof eventStatsTimelinePointSchema
>
export type EventStats = z.infer<typeof eventStatsSchema>
