import { z } from 'zod'

export const reportReasonSchema = z.enum([
  'HATE_SPEECH',
  'SPAM_OR_FRAUD',
  'HARASSMENT',
  'INAPPROPRIATE_CONTENT',
  'OTHER',
])

export const reportStatusSchema = z.enum([
  'PENDING',
  'REVIEWED',
  'RESOLVED_INVALID',
  'RESOLVED_REMOVED',
])

export const reportTargetTypeSchema = z.enum([
  'EVENT',
  'COMMENT',
  'MESSAGE',
  'USER',
])

export const createReportSchema = z.object({
  reason: reportReasonSchema,
  details: z.string().max(500).optional(),
})

// RESOLVED_REMOVED é permitido aqui para quando o conteúdo foi excluído por outro
// meio (ex: deleção direta pelo autor) e o admin só precisa fechar o ciclo da denúncia.
// Para remover o conteúdo E resolver, use DELETE /reports/:id/target.
export const resolveReportSchema = z.object({
  status: z.enum(['REVIEWED', 'RESOLVED_INVALID', 'RESOLVED_REMOVED']),
  resolutionNote: z.string().max(1000).optional(),
})

export const listReportsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().uuid().optional(),
  status: reportStatusSchema.optional(),
  reason: reportReasonSchema.optional(),
  targetType: reportTargetTypeSchema.optional(),
  reporterId: z.string().uuid().optional(),
  eventId: z.string().uuid().optional(),
  commentId: z.string().uuid().optional(),
  messageId: z.string().uuid().optional(),
  targetUserId: z.string().uuid().optional(),
})

export const reportParamSchema = z.object({
  id: z.string().uuid(),
})

export const reportEventParamSchema = z.object({
  eventId: z.string().uuid(),
})

export const reportCommentParamSchema = z.object({
  commentId: z.string().uuid(),
})

export const reportMessageParamSchema = z.object({
  messageId: z.string().uuid(),
})

export const reportUserParamSchema = z.object({
  userId: z.string().uuid(),
})

export type CreateReportBody = z.infer<typeof createReportSchema>
export type ResolveReportBody = z.infer<typeof resolveReportSchema>
export type ListReportsQuery = z.infer<typeof listReportsQuerySchema>
export type ReportParams = z.infer<typeof reportParamSchema>
export type ReportEventParams = z.infer<typeof reportEventParamSchema>
export type ReportCommentParams = z.infer<typeof reportCommentParamSchema>
export type ReportMessageParams = z.infer<typeof reportMessageParamSchema>
export type ReportUserParams = z.infer<typeof reportUserParamSchema>
