import { z } from 'zod'

export const followUserIdParamSchema = z.object({
  userId: z.uuid('ID inválido'),
})

export type FollowUserIdParam = z.infer<typeof followUserIdParamSchema>

export const followerIdParamSchema = z.object({
  followerId: z.uuid('ID do seguidor inválido'),
})

export type FollowerIdParam = z.infer<typeof followerIdParamSchema>

export const paginationSchema = z.object({
  limit: z.coerce.number().min(1).max(100).optional().default(20),
  cursor: z.uuid().optional(),
})

export type PaginationQuery = z.infer<typeof paginationSchema>
