import { realtime } from '../../lib/realtime'
import { uploadMessageImage } from '../../lib/uploads'
import { isBlockedEitherWay } from '../blocks/blocks.repository'
import {
  assertActiveParticipant,
  assertAdmin,
  assertReachable,
} from './chat.access'
import {
  createDirectConversation,
  createGroupConversation,
  createImageMessage,
  createTextMessage,
  deactivateParticipant,
  directKeyFor,
  findConversationById,
  findConversationMessages,
  findConversationWithParticipants,
  findDirectByKey,
  findMessageById,
  findParticipant,
  listInboxConversations,
  markConversationRead,
  reactivateParticipant,
  renameConversation,
  setParticipantRole,
  softDeleteMessage,
  unreadCounts,
} from './chat.repository'
import type { CreateConversationBody } from './chat.schema'

type MessageRow = Awaited<ReturnType<typeof createTextMessage>>
type ConversationRow = NonNullable<
  Awaited<ReturnType<typeof findConversationWithParticipants>>
>
type InboxRow = Awaited<ReturnType<typeof listInboxConversations>>[number]

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'P2002'
  )
}

function shapeParticipants(participants: ConversationRow['participants']) {
  return participants.map((p) => ({
    userId: p.userId,
    role: p.role,
    user: p.user,
  }))
}

function shapeConversation(conversation: ConversationRow) {
  return {
    id: conversation.id,
    type: conversation.type,
    title: conversation.title,
    lastMessageAt: conversation.lastMessageAt,
    createdAt: conversation.createdAt,
    participants: shapeParticipants(conversation.participants),
  }
}

function shapeMessage(message: MessageRow) {
  const deleted = message.deletedAt !== null
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    sender: message.sender,
    content: deleted ? null : message.content,
    attachments: deleted ? [] : message.attachments,
    createdAt: message.createdAt,
    deletedAt: message.deletedAt,
  }
}

function shapeInboxItem(conversation: InboxRow, unreadCount: number) {
  const last = conversation.messages[0]
  return {
    id: conversation.id,
    type: conversation.type,
    title: conversation.title,
    lastMessageAt: conversation.lastMessageAt,
    participants: shapeParticipants(conversation.participants),
    lastMessage: last ? shapeMessage(last) : null,
    unreadCount,
  }
}

/**
 * Autoriza o envio numa ÚNICA leitura da conversa (tipo + participantes ativos):
 * exige participante ativo e, em DM, ausência de bloqueio. Retorna os ids dos
 * participantes pra reuso na entrega ao vivo (evita refetch no hot path).
 */
async function authorizeSend(conversationId: string, userId: string) {
  const conversation = await findConversationWithParticipants(conversationId)
  if (!conversation) {
    throw { statusCode: 404, message: 'Conversa não encontrada' }
  }
  if (!conversation.participants.some((p) => p.userId === userId)) {
    throw { statusCode: 403, message: 'Você não participa desta conversa' }
  }
  if (conversation.type === 'DIRECT') {
    const others = conversation.participants.filter((p) => p.userId !== userId)
    for (const other of others) {
      if (await isBlockedEitherWay(userId, other.userId)) {
        throw {
          statusCode: 403,
          message: 'Não é possível enviar mensagens nesta conversa',
        }
      }
    }
  }
  return conversation.participants.map((p) => p.userId)
}

async function publishMessage(
  conversationId: string,
  participantIds: string[],
  message: MessageRow,
) {
  await realtime.publish({
    conversationId,
    participantIds,
    message: shapeMessage(message),
  })
}

async function requireGroup(conversationId: string) {
  const conversation = await findConversationById(conversationId)
  if (!conversation) {
    throw { statusCode: 404, message: 'Conversa não encontrada' }
  }
  if (conversation.type !== 'GROUP') {
    throw { statusCode: 400, message: 'Operação válida apenas para grupos' }
  }
  return conversation
}

export async function startConversation(
  userId: string,
  body: CreateConversationBody,
) {
  if (body.type === 'DIRECT') {
    await assertReachable(userId, body.targetUserId)
    const key = directKeyFor(userId, body.targetUserId)

    const existing = await findDirectByKey(key)
    if (existing) {
      return { conversation: shapeConversation(existing), created: false }
    }

    try {
      const created = await createDirectConversation(userId, body.targetUserId)
      return { conversation: shapeConversation(created), created: true }
    } catch (err) {
      // Corrida: outra request criou a mesma DM — refetch e devolve idempotente.
      if (isUniqueViolation(err)) {
        const refetched = await findDirectByKey(key)
        if (refetched) {
          return { conversation: shapeConversation(refetched), created: false }
        }
      }
      throw err
    }
  }

  const memberIds = [...new Set(body.participantIds)].filter(
    (id) => id !== userId,
  )
  if (memberIds.length === 0) {
    throw {
      statusCode: 400,
      message: 'Grupo precisa de ao menos um participante',
    }
  }
  // Em paralelo (não sequencial) pra não bloquear o event loop em grupos grandes.
  await Promise.all(
    memberIds.map((targetId) => assertReachable(userId, targetId)),
  )
  const created = await createGroupConversation(userId, body.title, memberIds)
  return { conversation: shapeConversation(created), created: true }
}

export async function listInbox(
  userId: string,
  limit: number,
  cursor?: string,
) {
  const conversations = await listInboxConversations(userId, limit, cursor)
  const unread = await unreadCounts(
    userId,
    conversations.map((c) => c.id),
  )
  const data = conversations.map((c) =>
    shapeInboxItem(c, unread.get(c.id) ?? 0),
  )
  const nextCursor =
    conversations.length === limit
      ? conversations[conversations.length - 1].id
      : null
  return { data, nextCursor }
}

export async function getConversation(userId: string, conversationId: string) {
  await assertActiveParticipant(conversationId, userId)
  const conversation = await findConversationWithParticipants(conversationId)
  if (!conversation) {
    throw { statusCode: 404, message: 'Conversa não encontrada' }
  }
  return shapeConversation(conversation)
}

export async function listMessages(
  userId: string,
  conversationId: string,
  limit: number,
  cursor?: string,
) {
  await assertActiveParticipant(conversationId, userId)
  const messages = await findConversationMessages(conversationId, limit, cursor)
  const nextCursor =
    messages.length === limit ? messages[messages.length - 1].id : null
  return { data: messages.map(shapeMessage), nextCursor }
}

export async function sendTextMessage(
  userId: string,
  conversationId: string,
  content: string,
) {
  const participantIds = await authorizeSend(conversationId, userId)
  const message = await createTextMessage(conversationId, userId, content)
  await publishMessage(conversationId, participantIds, message)
  return shapeMessage(message)
}

export async function sendImageMessage(
  userId: string,
  conversationId: string,
  buffer: Buffer,
) {
  const participantIds = await authorizeSend(conversationId, userId)
  const uploaded = await uploadMessageImage(buffer, conversationId)
  const message = await createImageMessage(conversationId, userId, null, {
    url: uploaded.url,
    key: uploaded.key,
    format: uploaded.format,
    size: uploaded.size,
  })
  await publishMessage(conversationId, participantIds, message)
  return shapeMessage(message)
}

export async function markAsRead(userId: string, conversationId: string) {
  await assertActiveParticipant(conversationId, userId)
  await markConversationRead(conversationId, userId)
}

export async function deleteMessage(
  userId: string,
  conversationId: string,
  messageId: string,
) {
  const participant = await assertActiveParticipant(conversationId, userId)
  const message = await findMessageById(messageId)
  if (!message || message.conversationId !== conversationId) {
    throw { statusCode: 404, message: 'Mensagem não encontrada' }
  }
  if (message.senderId !== userId && participant.role !== 'ADMIN') {
    throw {
      statusCode: 403,
      message: 'Sem permissão para apagar esta mensagem',
    }
  }
  if (message.deletedAt !== null) return // já apagada — idempotente
  await softDeleteMessage(messageId)
}

export async function addGroupParticipant(
  userId: string,
  conversationId: string,
  targetId: string,
) {
  const actor = await assertActiveParticipant(conversationId, userId)
  await requireGroup(conversationId)
  assertAdmin(actor)
  await assertReachable(userId, targetId)

  const existing = await findParticipant(conversationId, targetId)
  if (existing && existing.leftAt === null) {
    throw { statusCode: 409, message: 'Usuário já participa do grupo' }
  }
  await reactivateParticipant(conversationId, targetId)
  return getConversation(userId, conversationId)
}

export async function removeGroupParticipant(
  userId: string,
  conversationId: string,
  targetId: string,
) {
  const actor = await assertActiveParticipant(conversationId, userId)
  await requireGroup(conversationId)
  assertAdmin(actor)
  if (targetId === userId) {
    throw { statusCode: 400, message: 'Use sair do grupo para se remover' }
  }
  const result = await deactivateParticipant(conversationId, targetId)
  if (result.count === 0) {
    throw { statusCode: 404, message: 'Participante não encontrado' }
  }
}

export async function leaveGroup(userId: string, conversationId: string) {
  await assertActiveParticipant(conversationId, userId)
  await requireGroup(conversationId)
  await deactivateParticipant(conversationId, userId)
}

export async function renameGroup(
  userId: string,
  conversationId: string,
  title: string,
) {
  const actor = await assertActiveParticipant(conversationId, userId)
  await requireGroup(conversationId)
  assertAdmin(actor)
  await renameConversation(conversationId, title)
  return getConversation(userId, conversationId)
}

export async function setParticipantRoleService(
  userId: string,
  conversationId: string,
  targetId: string,
  role: 'MEMBER' | 'ADMIN',
) {
  const actor = await assertActiveParticipant(conversationId, userId)
  await requireGroup(conversationId)
  assertAdmin(actor)
  const target = await findParticipant(conversationId, targetId)
  if (!target || target.leftAt !== null) {
    throw { statusCode: 404, message: 'Participante não encontrado' }
  }
  await setParticipantRole(conversationId, targetId, role)
  return getConversation(userId, conversationId)
}
