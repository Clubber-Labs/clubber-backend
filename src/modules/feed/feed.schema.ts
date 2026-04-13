import { z } from 'zod'

export const feedQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(50).optional().default(20),
  cursor: z.uuid().optional(),
})

export type FeedQuery = z.infer<typeof feedQuerySchema>
