import type { Readable } from 'node:stream'
import { logger } from '../../lib/logger'
import { realtime } from '../../lib/realtime'
import { getStorage } from '../../lib/storage'
import {
  assertVideoFormat,
  deleteUploaded,
  MAX_VIDEO_SIZE,
  resourceTypeForKind,
  uploadMessageAudio,
  uploadMessageImage,
} from '../../lib/uploads'
import { isBlockedEitherWay } from '../blocks/blocks.repository'
import {
  assertActiveParticipant,
  assertAdmin,
  assertReachable,
} from './chat.access'
import {
  addMessageReaction,
  clearConversationForParticipant,
  createAttachmentMessage,
  createDirectConversation,
  createGroupConversation,
  createSystemMessage,
  createTextMessage,
  deactivateParticipant,
  directKeyFor,
  editMessageContent,
  findActiveParticipantUserIds,
  findConversationById,
  findConversationMessages,
  findConversationWithParticipants,
  findDirectByKey,
  findMessageAttachments,
  findMessageById,
  findMessageWithConversation,
  findParticipant,
  findUserBrief,
  listInboxConversations,
  markConversationDelivered,
  markConversationRead,
  reactivateParticipant,
  removeMessageReaction,
  renameConversation,
  setParticipantRole,
  softDeleteMessage,
  unreadCounts,
} from './chat.repository'
import type { AudioMessageMeta, CreateConversationBody } from './chat.schema'

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

function isRecordNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'P2025'
  )
}

function shapeParticipants(participants: ConversationRow['participants']) {
  return participants.map((p) => ({
    userId: p.userId,
    role: p.role,
    user: p.user,
    // Base dos recibos: o front deriva "entregue/visto" por mensagem comparando
    // lastDeliveredAt/lastReadAt dos outros participantes com message.createdAt.
    lastReadAt: p.lastReadAt,
    lastDeliveredAt: p.lastDeliveredAt,
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

function shapeReplyPreview(replyTo: MessageRow['replyTo']) {
  if (!replyTo) return null
  const deleted = replyTo.deletedAt !== null
  return {
    id: replyTo.id,
    senderId: replyTo.senderId,
    sender: replyTo.sender,
    content: deleted ? null : replyTo.content,
    deletedAt: replyTo.deletedAt,
  }
}

function shapeMessage(message: MessageRow) {
  const deleted = message.deletedAt !== null
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    sender: message.sender,
    type: message.type,
    content: deleted ? null : message.content,
    attachments: deleted ? [] : message.attachments,
    replyToId: message.replyToId,
    replyTo: deleted ? null : shapeReplyPreview(message.replyTo),
    // Lista crua [{ userId, emoji }] — o front agrega contagem e "minha".
    reactions: message.reactions,
    createdAt: message.createdAt,
    editedAt: message.editedAt,
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
    type: 'message',
    conversationId,
    participantIds,
    message: shapeMessage(message),
  })
}

/** Entrega ao vivo de uma mensagem alterada (edição ou reação). Best-effort. */
async function publishEditedMessage(
  conversationId: string,
  message: MessageRow,
) {
  const participantIds = await findActiveParticipantUserIds(conversationId)
  await realtime.publish({
    type: 'message_edited',
    conversationId,
    participantIds,
    message: shapeMessage(message),
  })
}

function displayName(user: { name: string; lastname: string }) {
  return `${user.name} ${user.lastname}`.trim()
}

/**
 * Persiste e entrega uma mensagem de sistema (entrou/saiu/renomeou). Tolerante
 * a falha: um erro aqui nunca derruba a mutação de grupo que a originou.
 */
async function emitSystemMessage(
  conversationId: string,
  actorId: string,
  content: string,
) {
  try {
    const message = await createSystemMessage(conversationId, actorId, content)
    const participantIds = await findActiveParticipantUserIds(conversationId)
    await publishMessage(conversationId, participantIds, message)
  } catch {
    // best-effort: a ação principal já foi confirmada
  }
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
  replyToId?: string,
) {
  const participantIds = await authorizeSend(conversationId, userId)
  if (replyToId) {
    // Citar exige que a mensagem original seja da MESMA conversa (evita vazar
    // conteúdo de outra conversa via preview do reply).
    const replyTo = await findMessageById(replyToId)
    if (!replyTo || replyTo.conversationId !== conversationId) {
      throw { statusCode: 400, message: 'Mensagem citada inválida' }
    }
  }
  const message = await createTextMessage(
    conversationId,
    userId,
    content,
    replyToId,
  )
  await publishMessage(conversationId, participantIds, message)
  return shapeMessage(message)
}

/**
 * Persiste a mensagem-anexo e, se o insert falhar DEPOIS do upload, remove o
 * asset órfão do storage antes de propagar o erro (best-effort). Evita lixo
 * pago no Cloudinary quando o banco rejeita a escrita.
 */
async function persistAttachmentOrCleanup(
  conversationId: string,
  userId: string,
  attachment: Parameters<typeof createAttachmentMessage>[3],
) {
  try {
    return await createAttachmentMessage(
      conversationId,
      userId,
      null,
      attachment,
    )
  } catch (err) {
    await deleteUploaded(
      attachment.key,
      logger,
      resourceTypeForKind(attachment.kind),
    )
    throw err
  }
}

export async function sendImageMessage(
  userId: string,
  conversationId: string,
  buffer: Buffer,
) {
  const participantIds = await authorizeSend(conversationId, userId)
  const uploaded = await uploadMessageImage(buffer, conversationId)
  const message = await persistAttachmentOrCleanup(conversationId, userId, {
    kind: 'IMAGE',
    url: uploaded.url,
    key: uploaded.key,
    format: uploaded.format,
    size: uploaded.size,
    width: uploaded.width,
    height: uploaded.height,
  })
  await publishMessage(conversationId, participantIds, message)
  return shapeMessage(message)
}

export async function sendAudioMessage(
  userId: string,
  conversationId: string,
  file: Readable & { truncated?: boolean },
  mimetype: string,
  meta: AudioMessageMeta,
) {
  let participantIds: string[]
  try {
    participantIds = await authorizeSend(conversationId, userId)
  } catch (err) {
    // Barramos ANTES de consumir o arquivo: drena o stream pra não deixar a
    // conexão pendurada (o multipart espera o corpo ser lido).
    file.resume()
    throw err
  }
  const uploaded = await uploadMessageAudio(file, conversationId, mimetype)
  const message = await persistAttachmentOrCleanup(conversationId, userId, {
    kind: 'AUDIO',
    url: uploaded.url,
    key: uploaded.key,
    format: uploaded.format,
    size: uploaded.size,
    durationMs: meta.durationMs,
    waveform: meta.waveform ?? [],
  })
  await publishMessage(conversationId, participantIds, message)
  return shapeMessage(message)
}

/** Pasta determinística do Cloudinary que isola os anexos de cada conversa. */
function conversationFolder(conversationId: string) {
  return `conversations/${conversationId}`
}

/**
 * Assina os params para o cliente subir um vídeo DIRETO ao Cloudinary. Exige
 * participante ativo (e, em DM, ausência de bloqueio) e trava a pasta na
 * conversa — só quem participa consegue uma assinatura para aquela pasta.
 */
export async function createVideoUploadSignature(
  userId: string,
  conversationId: string,
) {
  await authorizeSend(conversationId, userId)
  return getStorage().signUpload(conversationFolder(conversationId), 'video')
}

/**
 * Cria a mensagem de vídeo a partir do publicId que o cliente subiu direto.
 * NÃO confia no cliente: busca o asset no Cloudinary (fonte da verdade), exige
 * que ele esteja na pasta DESTA conversa e valida formato/tamanho server-side.
 */
export async function sendVideoMessage(
  userId: string,
  conversationId: string,
  publicId: string,
) {
  const participantIds = await authorizeSend(conversationId, userId)
  const asset = await getStorage().getAsset(publicId, 'video')
  if (!asset) {
    throw { statusCode: 400, message: 'Vídeo não encontrado no provedor' }
  }
  // Liga o asset à conversa: impede anexar vídeo de outra conversa/pasta mesmo
  // que o publicId exista. O prefixo é checado contra o public_id autoritativo.
  const folder = conversationFolder(conversationId)
  if (!asset.publicId.startsWith(`${folder}/`) && asset.folder !== folder) {
    throw { statusCode: 403, message: 'Vídeo não pertence a esta conversa' }
  }
  assertVideoFormat(asset.format)
  if (asset.bytes > MAX_VIDEO_SIZE) {
    throw { statusCode: 413, message: 'Vídeo excede o limite de 50 MB' }
  }
  const message = await persistAttachmentOrCleanup(conversationId, userId, {
    kind: 'VIDEO',
    url: asset.url,
    key: asset.publicId,
    format: asset.format,
    size: asset.bytes,
    durationMs: asset.durationMs,
    width: asset.width,
    height: asset.height,
    thumbnailUrl: asset.thumbnailUrl,
  })
  await publishMessage(conversationId, participantIds, message)
  return shapeMessage(message)
}

export async function markAsRead(userId: string, conversationId: string) {
  await assertActiveParticipant(conversationId, userId)
  await markConversationRead(conversationId, userId)
}

export async function markDelivered(userId: string, conversationId: string) {
  await assertActiveParticipant(conversationId, userId)
  await markConversationDelivered(conversationId, userId)
}

/** Oculta a conversa só para o viewer (DM ou grupo); não sai do grupo. */
export async function clearConversation(
  userId: string,
  conversationId: string,
) {
  await assertActiveParticipant(conversationId, userId)
  await clearConversationForParticipant(conversationId, userId)
}

export async function editMessage(
  userId: string,
  conversationId: string,
  messageId: string,
  content: string,
) {
  await assertActiveParticipant(conversationId, userId)
  const message = await findMessageById(messageId)
  if (!message || message.conversationId !== conversationId) {
    throw { statusCode: 404, message: 'Mensagem não encontrada' }
  }
  if (message.type === 'SYSTEM') {
    throw {
      statusCode: 403,
      message: 'Mensagem de sistema não pode ser editada',
    }
  }
  // Só o autor edita (admin de grupo NÃO edita msg alheia — diferente do delete).
  if (message.senderId !== userId) {
    throw {
      statusCode: 403,
      message: 'Sem permissão para editar esta mensagem',
    }
  }
  if (message.deletedAt !== null) {
    throw { statusCode: 403, message: 'Mensagem apagada não pode ser editada' }
  }
  if (message.content === null) {
    throw {
      statusCode: 403,
      message: 'Apenas mensagens de texto podem ser editadas',
    }
  }
  let updated: MessageRow
  try {
    updated = await editMessageContent(messageId, content)
  } catch (err) {
    // Corrida: um DELETE concorrente apagou a mensagem (P2025). Mesmo contrato
    // do check de deletedAt acima — não edita tombstone.
    if (isRecordNotFound(err)) {
      throw {
        statusCode: 403,
        message: 'Mensagem apagada não pode ser editada',
      }
    }
    throw err
  }
  await publishEditedMessage(conversationId, updated)
  return shapeMessage(updated)
}

async function loadMessageInConversation(
  conversationId: string,
  messageId: string,
) {
  const message = await findMessageById(messageId)
  if (!message || message.conversationId !== conversationId) {
    throw { statusCode: 404, message: 'Mensagem não encontrada' }
  }
  return message
}

export async function reactToMessage(
  userId: string,
  conversationId: string,
  messageId: string,
  emoji: string,
) {
  await assertActiveParticipant(conversationId, userId)
  const message = await loadMessageInConversation(conversationId, messageId)
  if (message.type === 'SYSTEM') {
    throw {
      statusCode: 403,
      message: 'Mensagem de sistema não pode receber reação',
    }
  }
  if (message.deletedAt !== null) {
    throw {
      statusCode: 403,
      message: 'Mensagem apagada não pode receber reação',
    }
  }
  await addMessageReaction(messageId, userId, emoji)
  const updated = await findMessageWithConversation(messageId)
  if (!updated) {
    throw { statusCode: 404, message: 'Mensagem não encontrada' }
  }
  await publishEditedMessage(conversationId, updated)
  return shapeMessage(updated)
}

// Diferente de reactToMessage, NÃO bloqueia mensagem apagada/SYSTEM de
// propósito: remover a própria reação é um "desfazer" idempotente e deve
// sempre funcionar (inclusive numa mensagem que acabou de ser apagada),
// senão a reação ficaria presa. A simetria com reactToMessage é intencional
// só no caminho de adicionar.
export async function removeReaction(
  userId: string,
  conversationId: string,
  messageId: string,
  emoji: string,
) {
  await assertActiveParticipant(conversationId, userId)
  await loadMessageInConversation(conversationId, messageId)
  await removeMessageReaction(messageId, userId, emoji)
  const updated = await findMessageWithConversation(messageId)
  if (!updated) {
    throw { statusCode: 404, message: 'Mensagem não encontrada' }
  }
  await publishEditedMessage(conversationId, updated)
  return shapeMessage(updated)
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
  if (message.type === 'SYSTEM') {
    throw {
      statusCode: 403,
      message: 'Mensagem de sistema não pode ser apagada',
    }
  }
  if (message.senderId !== userId && participant.role !== 'ADMIN') {
    throw {
      statusCode: 403,
      message: 'Sem permissão para apagar esta mensagem',
    }
  }
  if (message.deletedAt !== null) return // já apagada — idempotente
  await softDeleteMessage(messageId)
  // Remove os arquivos no storage (best-effort): a falha de storage NÃO reverte
  // o soft-delete. Sem isso, áudio/imagem/vídeo apagados viram lixo pago eterno.
  const attachments = await findMessageAttachments(messageId)
  for (const att of attachments) {
    await deleteUploaded(att.key, logger, resourceTypeForKind(att.kind))
  }
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
  const [actorUser, targetUser] = await Promise.all([
    findUserBrief(userId),
    findUserBrief(targetId),
  ])
  if (actorUser && targetUser) {
    await emitSystemMessage(
      conversationId,
      userId,
      `${displayName(actorUser)} adicionou ${displayName(targetUser)}`,
    )
  }
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
  const [actorUser, targetUser] = await Promise.all([
    findUserBrief(userId),
    findUserBrief(targetId),
  ])
  if (actorUser && targetUser) {
    await emitSystemMessage(
      conversationId,
      userId,
      `${displayName(actorUser)} removeu ${displayName(targetUser)}`,
    )
  }
}

export async function leaveGroup(userId: string, conversationId: string) {
  await assertActiveParticipant(conversationId, userId)
  await requireGroup(conversationId)
  await deactivateParticipant(conversationId, userId)
  const actorUser = await findUserBrief(userId)
  if (actorUser) {
    await emitSystemMessage(
      conversationId,
      userId,
      `${displayName(actorUser)} saiu do grupo`,
    )
  }
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
  const actorUser = await findUserBrief(userId)
  if (actorUser) {
    await emitSystemMessage(
      conversationId,
      userId,
      `${displayName(actorUser)} alterou o nome do grupo para "${title}"`,
    )
  }
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
