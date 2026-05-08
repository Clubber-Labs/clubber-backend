import { z } from 'zod'

export const reportReasonSchema = z.enum([
  'HATE_SPEECH',
  'SPAM_OR_FRAUD',
  'HARASSMENT',
  'INAPPROPRIATE_CONTENT',
  'OTHER',
])

export const createReportSchema = z.object({
  reason: reportReasonSchema,
  details: z.string().max(500).optional(),
})

export const reportEventParamSchema = z.object({
  eventId: z.string().uuid(),
})

export const reportCommentParamSchema = z.object({
  commentId: z.string().uuid(),
})

export type CreateReportBody = z.infer<typeof createReportSchema>
export type ReportEventParams = z.infer<typeof reportEventParamSchema>
export type ReportCommentParams = z.infer<typeof reportCommentParamSchema>
