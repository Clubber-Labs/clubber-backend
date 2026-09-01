import { z } from 'zod'

export const eventIdParamSchema = z.object({
  eventId: z.uuid('ID do evento inválido'),
})

export type EventIdParam = z.infer<typeof eventIdParamSchema>

export const postParamSchema = z.object({
  eventId: z.uuid('ID do evento inválido'),
  postId: z.uuid('ID do post inválido'),
})

export type PostParam = z.infer<typeof postParamSchema>

export const postImageParamSchema = z.object({
  eventId: z.uuid('ID do evento inválido'),
  postId: z.uuid('ID do post inválido'),
  imageId: z.uuid('ID da imagem inválido'),
})

export type PostImageParam = z.infer<typeof postImageParamSchema>

// A ordem é um rearranjo EXATO da galeria: o service recusa lista com id
// repetido, faltando ou de outro post (IMAGE_ORDER_MISMATCH).
export const reorderPostImagesSchema = z.object({
  order: z.array(z.uuid()).min(1),
})

export type ReorderPostImagesBody = z.infer<typeof reorderPostImagesSchema>

export const createPostSchema = z.object({
  content: z.string().min(1, 'Conteúdo obrigatório').max(1000),
})

export type CreatePostBody = z.infer<typeof createPostSchema>

export const paginationSchema = z.object({
  limit: z.coerce.number().min(1).max(100).optional().default(20),
  cursor: z.uuid().optional(),
})

export type PaginationQuery = z.infer<typeof paginationSchema>
