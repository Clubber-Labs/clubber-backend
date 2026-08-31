import { z } from 'zod'

export const eventCheckInParamSchema = z.object({
  eventId: z.uuid('ID do evento inválido'),
})

export type EventCheckInParam = z.infer<typeof eventCheckInParamSchema>
