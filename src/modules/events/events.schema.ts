import { z } from 'zod'

export const createEventSchema = z.object({
  title: z.string().min(3),
  description: z.string().min(10),
  date: z.coerce.date(),
  latitude: z.number(),
  longitude: z.number(),
  address: z.string().optional(),
  category: z.string().min(2),
  isPublic: z.boolean().default(true),
  imageUrl: z.string().optional(),
  maxCapacity: z.number().optional(),
  canceledAt: z.coerce.date().optional(),
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

export const listEventsQuerySchema = z.object({
  category: z.string().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

export const userEventsParamsSchema = z.object({
  userId: z.string().uuid(),
})

export const userEventsQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

export type UserEventsParams = z.infer<typeof userEventsParamsSchema>
export type UserEventsQuery = z.infer<typeof userEventsQuerySchema>
export type CreateEventBody = z.infer<typeof createEventSchema>
export type UpdateEventBody = z.infer<typeof updateEventSchema>
export type EventParams = z.infer<typeof eventParamSchema>
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>
