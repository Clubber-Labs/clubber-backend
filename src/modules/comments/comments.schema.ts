import { z } from 'zod'

export const eventCommentParamSchema = z.object({
  eventId: z.uuid('ID do evento inválido'),
})

export type EventCommentParam = z.infer<typeof eventCommentParamSchema>

export const eventCommentIdParamSchema = z.object({
  eventId: z.uuid('ID do evento inválido'),
  commentId: z.uuid('ID do comentário inválido'),
})

export type EventCommentIdParam = z.infer<typeof eventCommentIdParamSchema>

export const postCommentParamSchema = z.object({
  postId: z.uuid('ID do post inválido'),
})

export type PostCommentParam = z.infer<typeof postCommentParamSchema>

export const postCommentIdParamSchema = z.object({
  postId: z.uuid('ID do post inválido'),
  commentId: z.uuid('ID do comentário inválido'),
})

export type PostCommentIdParam = z.infer<typeof postCommentIdParamSchema>

export const createCommentSchema = z.object({
  content: z.string().min(1, 'Conteúdo obrigatório').max(500),
})

export type CreateCommentBody = z.infer<typeof createCommentSchema>

export const paginationSchema = z.object({
  limit: z.coerce.number().min(1).max(100).optional().default(20),
  cursor: z.uuid().optional(),
})

export type PaginationQuery = z.infer<typeof paginationSchema>
