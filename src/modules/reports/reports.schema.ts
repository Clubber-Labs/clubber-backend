import { z } from 'zod'

export const reportReasonSchema = z.enum([
    'HATE_SPEECH',
    'SPAM_OR_FRAUD',
    'HARASSMENT',
    'INAPPROPRIATE_CONTENT',
    'OTHER'
])

export const createReportSchema = z.object({
    reason: reportReasonSchema,
    details: z.string().max(500).optional
})

export type CreateReportBody = z.infer<typeof createReportSchema>