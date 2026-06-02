import type { FastifyReply, FastifyRequest } from 'fastify'
import { assertImageMimetype } from '../../lib/uploads'
import type {
  AddParticipantBody,
  ChatPaginationQuery,
  ConversationParam,
  CreateConversationBody,
  EditMessageBody,
  MessageParam,
  MessageReactionBody,
  ParticipantParam,
  RenameConversationBody,
  SendMessageBody,
  SetRoleBody,
} from './chat.schema'
import {
  addGroupParticipant,
  clearConversation,
  deleteMessage,
  editMessage,
  getConversation,
  leaveGroup,
  listInbox,
  listMessages,
  markAsRead,
  markDelivered,
  reactToMessage,
  removeGroupParticipant,
  removeReaction,
  renameGroup,
  sendImageMessage,
  sendTextMessage,
  setParticipantRoleService,
  startConversation,
} from './chat.service'

export async function postConversation(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { conversation, created } = await startConversation(
    request.user.sub,
    request.body as CreateConversationBody,
  )
  return reply.status(created ? 201 : 200).send(conversation)
}

export async function getConversations(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { limit, cursor } = request.query as ChatPaginationQuery
  const result = await listInbox(request.user.sub, limit, cursor)
  return reply.send(result)
}

export async function getConversationDetail(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as ConversationParam
  const conversation = await getConversation(request.user.sub, id)
  return reply.send(conversation)
}

export async function getMessages(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as ConversationParam
  const { limit, cursor } = request.query as ChatPaginationQuery
  const result = await listMessages(request.user.sub, id, limit, cursor)
  return reply.send(result)
}

export async function postMessage(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as ConversationParam
  const { content, replyToId } = request.body as SendMessageBody
  const message = await sendTextMessage(
    request.user.sub,
    id,
    content,
    replyToId,
  )
  return reply.status(201).send(message)
}

export async function postMessageImage(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as ConversationParam
  const data = await request.file()
  if (!data) {
    throw { statusCode: 400, message: 'Nenhuma imagem foi enviada' }
  }
  assertImageMimetype(data.mimetype)
  const buffer = await data.toBuffer()
  const message = await sendImageMessage(request.user.sub, id, buffer)
  return reply.status(201).send(message)
}

export async function postRead(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as ConversationParam
  await markAsRead(request.user.sub, id)
  return reply.status(204).send()
}

export async function postDelivered(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as ConversationParam
  await markDelivered(request.user.sub, id)
  return reply.status(204).send()
}

export async function deleteConversation(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as ConversationParam
  await clearConversation(request.user.sub, id)
  return reply.status(204).send()
}

export async function patchMessage(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id, messageId } = request.params as MessageParam
  const { content } = request.body as EditMessageBody
  const message = await editMessage(request.user.sub, id, messageId, content)
  return reply.send(message)
}

export async function postMessageReaction(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id, messageId } = request.params as MessageParam
  const { emoji } = request.body as MessageReactionBody
  const message = await reactToMessage(request.user.sub, id, messageId, emoji)
  return reply.status(201).send(message)
}

export async function deleteMessageReaction(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id, messageId } = request.params as MessageParam
  const { emoji } = request.body as MessageReactionBody
  const message = await removeReaction(request.user.sub, id, messageId, emoji)
  return reply.send(message)
}

export async function deleteMessageHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id, messageId } = request.params as MessageParam
  await deleteMessage(request.user.sub, id, messageId)
  return reply.status(204).send()
}

export async function postParticipant(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as ConversationParam
  const { userId } = request.body as AddParticipantBody
  const conversation = await addGroupParticipant(request.user.sub, id, userId)
  return reply.status(201).send(conversation)
}

export async function deleteParticipant(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id, userId } = request.params as ParticipantParam
  await removeGroupParticipant(request.user.sub, id, userId)
  return reply.status(204).send()
}

export async function postLeave(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as ConversationParam
  await leaveGroup(request.user.sub, id)
  return reply.status(204).send()
}

export async function patchConversation(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as ConversationParam
  const { title } = request.body as RenameConversationBody
  const conversation = await renameGroup(request.user.sub, id, title)
  return reply.send(conversation)
}

export async function patchParticipantRole(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id, userId } = request.params as ParticipantParam
  const { role } = request.body as SetRoleBody
  const conversation = await setParticipantRoleService(
    request.user.sub,
    id,
    userId,
    role,
  )
  return reply.send(conversation)
}
