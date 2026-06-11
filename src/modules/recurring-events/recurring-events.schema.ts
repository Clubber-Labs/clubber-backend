import { z } from 'zod'

// Regra de recorrência aninhada no corpo de POST /events. A validação
// cruzada com a data do evento (until ≤ date + 1 ano) mora no createEventSchema,
// que é quem enxerga os dois campos.
export const recurrenceSchema = z
  .object({
    frequency: z.enum(['WEEKLY', 'MONTHLY']),
    interval: z.number().int().min(1).max(12).default(1),
    until: z.coerce.date().optional(),
    count: z.number().int().min(2).max(52).optional(),
  })
  .refine((v) => !(v.until && v.count), {
    message: 'until e count são mutuamente exclusivos',
    path: ['until'],
  })

export const seriesParamsSchema = z.object({
  seriesId: z.uuid(),
})

export type RecurrenceInput = z.infer<typeof recurrenceSchema>
export type SeriesParams = z.infer<typeof seriesParamsSchema>
