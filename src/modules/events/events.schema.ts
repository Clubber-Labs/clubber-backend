import { z } from 'zod'

export const createEventSchema = z.object({
  title: z.string().min(3),
  description: z.string().min(10),
  date: z.coerce.date(),
  latitude: z.number(),
  longitude: z.number(),
  category: z.string().min(2),
  isPublic: z.boolean().default(true),
})

export const updateEventSchema = z.object({
  title: z.string().min(3).optional(),
  description: z.string().min(10).optional(),
  date: z.coerce.date().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  category: z.string().min(2).optional(),
  isPublic: z.boolean().optional(),
})

export const eventParamSchema = z.object({
  id: z.string().uuid(),
})

export type CreateEventBody = z.infer<typeof createEventSchema>
export type UpdateEventBody = z.infer<typeof updateEventSchema>
export type EventParams = z.infer<typeof eventParamSchema>
