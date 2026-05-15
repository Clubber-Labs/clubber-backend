import { z } from 'zod'
import {
  booleanQuery,
  categoryFilter,
  statusFilter,
} from '../events/events.schema'

export const feedQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(50).optional().default(20),
  cursor: z.uuid().optional(),
  category: categoryFilter,
  status: statusFilter,
  includePast: booleanQuery.default(true),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
})

export type FeedQuery = z.infer<typeof feedQuerySchema>
