import { z } from 'zod'

export const createConversationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('DIRECT'),
    targetUserId: z.uuid('ID de usuário inválido'),
  }),
  z.object({
    type: z.literal('GROUP'),
    title: z.string().min(1, 'Título obrigatório').max(100),
    participantIds: z.array(z.uuid()).min(1).max(50),
  }),
])

export const conversationParamSchema = z.object({
  id: z.uuid('ID de conversa inválido'),
})

export const messageParamSchema = z.object({
  id: z.uuid('ID de conversa inválido'),
  messageId: z.uuid('ID de mensagem inválido'),
})

export const participantParamSchema = z.object({
  id: z.uuid('ID de conversa inválido'),
  userId: z.uuid('ID de usuário inválido'),
})

export const sendMessageSchema = z.object({
  content: z.string().min(1, 'Mensagem vazia').max(2000),
  replyToId: z.uuid().optional(),
})

export const editMessageSchema = z.object({
  content: z.string().trim().min(1, 'Mensagem vazia').max(2000),
})

export const messageReactionSchema = z.object({
  // max 32: .length conta code units UTF-16, e sequências ZWJ (família
  // 👨‍👩‍👧‍👦 = 11, bandeiras compostas) passariam de 16. 32 cobre com folga.
  emoji: z.string().min(1).max(32),
})

export const renameConversationSchema = z.object({
  title: z.string().min(1, 'Título obrigatório').max(100),
})

export const addParticipantSchema = z.object({
  userId: z.uuid('ID de usuário inválido'),
})

export const setRoleSchema = z.object({
  role: z.enum(['MEMBER', 'ADMIN']),
})

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  cursor: z.uuid().optional(),
})

export type CreateConversationBody = z.infer<typeof createConversationSchema>
export type ConversationParam = z.infer<typeof conversationParamSchema>
export type MessageParam = z.infer<typeof messageParamSchema>
export type ParticipantParam = z.infer<typeof participantParamSchema>
export type SendMessageBody = z.infer<typeof sendMessageSchema>
export type EditMessageBody = z.infer<typeof editMessageSchema>
export type MessageReactionBody = z.infer<typeof messageReactionSchema>
export type RenameConversationBody = z.infer<typeof renameConversationSchema>
export type AddParticipantBody = z.infer<typeof addParticipantSchema>
export type SetRoleBody = z.infer<typeof setRoleSchema>
export type ChatPaginationQuery = z.infer<typeof paginationSchema>
