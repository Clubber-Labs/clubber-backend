import { z } from 'zod'

export const adminConsentAuditQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  action: z.enum(['GRANTED', 'UPDATED', 'REVOKED', 'EXPORTED']).optional(),
  startDate: z.string().datetime({ offset: true }).optional(),
  endDate: z.string().datetime({ offset: true }).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export const adminConsentUserParamSchema = z.object({
  userId: z.string().uuid(),
})

export const adminConsentAuditEntrySchema = z.object({
  id: z.string(),
  userId: z.string(),
  userName: z.string(),
  action: z.enum(['GRANTED', 'UPDATED', 'REVOKED', 'EXPORTED']),
  timestamp: z.string(),
  ipAddress: z.string().nullable(),
  metadata: z.unknown(),
})

export const adminConsentAuditResponseSchema = z.object({
  data: z.array(adminConsentAuditEntrySchema),
  nextCursor: z.string().nullable(),
})

export const adminConsentStatsSchema = z.object({
  totalUsersWithActiveConsent: z.number(),
  totalRevocations: z.number(),
  totalExports: z.number(),
  actionDistribution: z.object({
    GRANTED: z.number(),
    UPDATED: z.number(),
    REVOKED: z.number(),
    EXPORTED: z.number(),
  }),
})

export type AdminConsentAuditQuery = z.infer<
  typeof adminConsentAuditQuerySchema
>
export type AdminConsentUserParam = z.infer<typeof adminConsentUserParamSchema>
