import { z } from 'zod'

export const createBlockSchema = z.object({
  userId: z.uuid('ID de usuário inválido'),
})

export const blockParamSchema = z.object({
  userId: z.uuid('ID de usuário inválido'),
})

export const blockListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  cursor: z.uuid().optional(),
})

export type CreateBlockBody = z.infer<typeof createBlockSchema>
export type BlockParam = z.infer<typeof blockParamSchema>
export type BlockListQuery = z.infer<typeof blockListQuerySchema>
