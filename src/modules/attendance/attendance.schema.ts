import { z } from 'zod'

export const eventParamsSchema = z.object({
  eventId: z.uuid(),
})

export type EventParams = z.infer<typeof eventParamsSchema>

export const attendanceBodySchema = z.object({
  type: z.enum(['INTERESTED', 'CONFIRMED', 'NOT_INTERESTED']),
})

export type AttendanceBody = z.infer<typeof attendanceBodySchema>
