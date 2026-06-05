import type { FastifyReply, FastifyRequest } from 'fastify'
import { assertAudioMimetype, assertImageMimetype } from '../../lib/uploads'
import {
  type AddParticipantBody,
  type AudioMessageMeta,
  audioMessageMetaSchema,
  type ChatPaginationQuery,
  type ConversationParam,
  type CreateConversationBody,
  type CreateVideoMessageBody,
  type EditMessageBody,
  type MessageParam,
  type MessageReactionBody,
  type ParticipantParam,
  type RenameConversationBody,
  type SendMessageBody,
  type SetRoleBody,
} from './chat.schema'
import {
  addGroupParticipant,
  clearConversation,
  createVideoUploadSignature,
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
  sendAudioMessage,
  sendImageMessage,
  sendTextMessage,
  sendVideoMessage,
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

/** Lê o valor de um campo de texto do multipart (durationMs, waveform). */
function multipartFieldValue(
  fields: Record<string, unknown>,
  name: string,
): string | undefined {
  const field = fields[name]
  const one = Array.isArray(field) ? field[0] : field
  const value = (one as { value?: unknown } | undefined)?.value
  return typeof value === 'string' ? value : undefined
}

function parseAudioMeta(fields: Record<string, unknown>): AudioMessageMeta {
  const durationMs = multipartFieldValue(fields, 'durationMs')
  const waveformRaw = multipartFieldValue(fields, 'waveform')
  let waveform: unknown
  if (waveformRaw !== undefined) {
    try {
      waveform = JSON.parse(waveformRaw)
    } catch {
      throw { statusCode: 400, message: 'waveform inválido: JSON esperado' }
    }
  }
  const parsed = audioMessageMetaSchema.safeParse({ durationMs, waveform })
  if (!parsed.success) {
    // Expõe a mensagem do primeiro campo inválido (PT, definidas no schema)
    // em vez de um genérico — facilita o debug no cliente.
    throw {
      statusCode: 400,
      message:
        parsed.error.issues[0]?.message ?? 'Metadados de áudio inválidos',
    }
  }
  return parsed.data
}

export async function postMessageAudio(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as ConversationParam
  // throwFileSizeLimit: false → não lança no teto; o áudio sobe em STREAM (sem
  // toBuffer) e o truncamento é tratado na camada de upload (413).
  const data = await request.file({ throwFileSizeLimit: false })
  if (!data) {
    throw { statusCode: 400, message: 'Nenhum áudio foi enviado' }
  }
  assertAudioMimetype(data.mimetype)
  // Campos de texto (enviados antes do arquivo) já estão em data.fields aqui.
  const meta = parseAudioMeta(data.fields as Record<string, unknown>)
  const message = await sendAudioMessage(
    request.user.sub,
    id,
    data.file,
    data.mimetype,
    meta,
  )
  return reply.status(201).send(message)
}

export async function postVideoUploadSignature(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as ConversationParam
  const signature = await createVideoUploadSignature(request.user.sub, id)
  return reply.send(signature)
}

export async function postMessageVideo(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as ConversationParam
  const { publicId } = request.body as CreateVideoMessageBody
  const message = await sendVideoMessage(request.user.sub, id, publicId)
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
