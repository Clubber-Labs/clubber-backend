import { z } from 'zod'
import {
  booleanQuery,
  categoryFilter,
  statusFilter,
} from '../events/events.schema'

export const feedQuerySchema = z
  .object({
    limit: z.coerce.number().min(1).max(50).optional().default(20),
    // Cursor opaco (base64url de { score, id, t }) — keyset por (score, id);
    // `t` congela o relógio de RANKING entre as páginas (não afeta filtros).
    cursor: z.string().optional(),
    category: categoryFilter,
    status: statusFilter,
    includePast: booleanQuery.default(true),
    dateFrom: z.coerce.date().optional(),
    dateTo: z.coerce.date().optional(),
    // Localização do dispositivo (enviada ao abrir o app) — habilita proximidade.
    nearLat: z.coerce.number().min(-90).max(90).optional(),
    nearLng: z.coerce.number().min(-180).max(180).optional(),
    radiusKm: z.coerce.number().positive().max(500).optional(),
  })
  .refine((q) => (q.nearLat === undefined) === (q.nearLng === undefined), {
    message: 'nearLat e nearLng devem ser fornecidos juntos',
    path: ['nearLat'],
  })
  .refine(
    (q) =>
      q.radiusKm === undefined ||
      (q.nearLat !== undefined && q.nearLng !== undefined),
    { message: 'radiusKm exige nearLat e nearLng', path: ['radiusKm'] },
  )

export type FeedQuery = z.infer<typeof feedQuerySchema>
