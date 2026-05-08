import { z } from 'zod'

export const AdminBanBodySchema = z.object({
    reason: z.string().min(5).max(500).optional(),
})

export const AdminResolveReportBodySchema = z.object({
    status: z.enum(['REVIEWED', 'RESOLVED_INVALID', 'RESOLVED_REMOVED']),
    resolvedReason: z.string().min(5).max(500).optional(),
})

export const AdminListReportsQuerySchema = z.object({
    status: z.enum(['PENDING', 'REVIEWED', 'RESOLVED_INVALID', 'RESOLVED_REMOVED']).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().uuid().optional(),
})

export type AdminBanBody = z.infer<typeof AdminBanBodySchema>
export type AdminResolveReportBody = z.infer<typeof AdminResolveReportBodySchema>
export type AdminListReportsQuery = z.infer<typeof AdminListReportsQuerySchema>