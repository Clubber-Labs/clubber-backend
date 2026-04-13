import { z } from 'zod'

export const eventReactionParamSchema = z.object({
  eventId: z.uuid('ID do evento inválido'),
})

export type EventReactionParam = z.infer<typeof eventReactionParamSchema>

export const postReactionParamSchema = z.object({
  postId: z.uuid('ID do post inválido'),
})

export type PostReactionParam = z.infer<typeof postReactionParamSchema>

export const reactionBodySchema = z.object({
  type: z.enum(['LIKE', 'LOVE', 'HAHA', 'WOW', 'SAD', 'ANGRY']),
})

export type ReactionBody = z.infer<typeof reactionBodySchema>
