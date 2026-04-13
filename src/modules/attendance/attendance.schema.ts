import { z } from 'zod'

export const eventParamsSchema = z.object({
  eventId: z.string().uuid(),
})

export type EventParams = z.infer<typeof eventParamsSchema>
