import type { Readable } from 'node:stream'
import { env } from '../../lib/env'
import { AppError } from '../../lib/errors/app-error'
import { logger } from '../../lib/logger'
import { realtime } from '../../lib/realtime'
import { getStorage } from '../../lib/storage'
import {
  assertVideoFormat,
  deleteChatMedia,
  MAX_VIDEO_SIZE,
  uploadMessageAudio,
  uploadMessageImage,
} from '../../lib/uploads'
import { isBlockedEitherWay } from '../blocks/blocks.repository'
import { displayName } from '../notifications/notification-content'
import { enqueueChatMessagePush } from '../notifications/notification-queue'
import {
  assertActiveParticipant,
  assertAdmin,
  assertReachable,
} from './chat.access'
import { encryptContent, hydrateMessage, hydrateMessages } from './chat.crypto'
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
  findMessageByIdempotencyKey,
  findMessageWithConversation,
  findParticipant,
  findUserBrief,
  listInboxConversations,
  markConversationDelivered,
  markConversationRead,
  QuotaExceededError,
  reactivateParticipant,
  removeMessageReaction,
  renameConversation,
  setParticipantRole,
  softDeleteMessage,
  sumUserActiveMediaBytes,
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

/**
 * A mídia é privada (delivery 'authenticated'): troca a URL pública persistida
 * por uma URL ASSINADA gerada da key e DESCARTA a key (não vaza no payload). Só
 * participantes chegam aqui → quem saiu/bloqueou não recebe URL nova (revogação
 * pela autorização).
 */
function shapeAttachments(attachments: MessageRow['attachments']) {
  const storage = getStorage()
  return attachments.map(({ key, thumbnailKey, ...rest }) => ({
    ...rest,
    url: storage.signedUrl(key),
    // Vídeo novo tem o poster em key própria (thumbnailKey); o fallback
    // preserva vídeos legados do Cloudinary cuja thumbnailUrl persistida já é
    // uma URL assinada eterna (sem key própria de poster).
    thumbnailUrl: thumbnailKey
      ? storage.signedUrl(thumbnailKey)
      : rest.thumbnailUrl,
  }))
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
    attachments: deleted ? [] : shapeAttachments(message.attachments),
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
    throw new AppError(404, 'CONVERSATION_NOT_FOUND')
  }
  if (!conversation.participants.some((p) => p.userId === userId)) {
    throw new AppError(403, 'NOT_CONVERSATION_MEMBER')
  }
  if (conversation.type === 'DIRECT') {
    const others = conversation.participants.filter((p) => p.userId !== userId)
    for (const other of others) {
      if (await isBlockedEitherWay(userId, other.userId)) {
        throw new AppError(403, 'CONVERSATION_READ_ONLY')
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
    // O gateway usa estes pra marcar entrega server-side sem abrir o payload.
    senderId: message.senderId,
    createdAt: message.createdAt.toISOString(),
    message: shapeMessage(message),
  })
  // Push com delay pra quem não receber via socket. Mensagem de sistema não
  // notifica (entrou/saiu/renomeou é ruído no canal do SO).
  if (message.type !== 'SYSTEM') {
    await enqueueChatMessagePush(message.id)
  }
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
    const encrypted = await encryptContent(conversationId, content)
    const message = await createSystemMessage(
      conversationId,
      actorId,
      encrypted,
    )
    const participantIds = await findActiveParticipantUserIds(conversationId)
    await publishMessage(
      conversationId,
      participantIds,
      await hydrateMessage(message),
    )
  } catch (err) {
    // best-effort: a ação principal já foi confirmada. Mas LOGA — engolir em
    // silêncio esconderia uma falha de chave, que é sintoma grave.
    logger.error(
      `Falha ao emitir mensagem de sistema em ${conversationId}: ${(err as Error).message}`,
    )
  }
}

async function requireGroup(conversationId: string) {
  const conversation = await findConversationById(conversationId)
  if (!conversation) {
    throw new AppError(404, 'CONVERSATION_NOT_FOUND')
  }
  if (conversation.type !== 'GROUP') {
    throw new AppError(400, 'GROUP_ONLY_OPERATION')
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
    throw new AppError(400, 'GROUP_NEEDS_PARTICIPANT')
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
  // Um lote só para o inbox inteiro: N conversas = N unwraps (quase todos em
  // cache), não um por mensagem.
  await hydrateMessages(conversations.flatMap((c) => c.messages))
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
    throw new AppError(404, 'CONVERSATION_NOT_FOUND')
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
  await hydrateMessages(messages)
  const nextCursor =
    messages.length === limit ? messages[messages.length - 1].id : null
  return { data: messages.map(shapeMessage), nextCursor }
}

/**
 * Idempotência de envio: se já existe uma mensagem com esta `idempotencyKey`
 * (mesma conversa+remetente), devolve a existente — retry não duplica. Null se
 * não houver key ou ainda não existir.
 */
async function findIdempotentMessage(
  conversationId: string,
  userId: string,
  idempotencyKey?: string,
) {
  if (!idempotencyKey) return null
  const existing = await findMessageByIdempotencyKey(
    conversationId,
    userId,
    idempotencyKey,
  )
  return existing ? shapeMessage(await hydrateMessage(existing)) : null
}

/**
 * Corrida: dois envios concorrentes com a mesma key passam pelo check inicial e
 * ambos tentam inserir; o segundo viola o unique (P2002). Aqui devolvemos a
 * mensagem que venceu em vez de propagar o erro. Null se não for esse caso.
 */
async function resolveIdempotencyConflict(
  err: unknown,
  conversationId: string,
  userId: string,
  idempotencyKey?: string,
) {
  if (!idempotencyKey || !isUniqueViolation(err)) return null
  // Garante que o P2002 foi do unique de idempotência e não de uma constraint
  // futura — senão devolveríamos a mensagem errada e mascararíamos o erro real.
  // `meta.target` pode ser array de campos ou o nome do índice (ou ausente).
  const target = (err as { meta?: { target?: unknown } }).meta?.target
  if (target !== undefined) {
    const fields = Array.isArray(target) ? target.join(',') : String(target)
    if (!fields.includes('idempotencyKey')) return null
  }
  const existing = await findMessageByIdempotencyKey(
    conversationId,
    userId,
    idempotencyKey,
  )
  return existing ? shapeMessage(await hydrateMessage(existing)) : null
}

export async function sendTextMessage(
  userId: string,
  conversationId: string,
  content: string,
  replyToId?: string,
  idempotencyKey?: string,
) {
  const participantIds = await authorizeSend(conversationId, userId)
  const existing = await findIdempotentMessage(
    conversationId,
    userId,
    idempotencyKey,
  )
  if (existing) return existing
  if (replyToId) {
    // Citar exige que a mensagem original seja da MESMA conversa (evita vazar
    // conteúdo de outra conversa via preview do reply).
    const replyTo = await findMessageById(replyToId)
    if (!replyTo || replyTo.conversationId !== conversationId) {
      throw new AppError(400, 'INVALID_REPLY_MESSAGE')
    }
  }
  const encrypted = await encryptContent(conversationId, content)
  let message: MessageRow
  try {
    message = await createTextMessage(
      conversationId,
      userId,
      encrypted,
      replyToId,
      idempotencyKey,
    )
  } catch (err) {
    const dup = await resolveIdempotencyConflict(
      err,
      conversationId,
      userId,
      idempotencyKey,
    )
    if (dup) return dup
    throw err
  }
  await hydrateMessage(message)
  await publishMessage(conversationId, participantIds, message)
  return shapeMessage(message)
}

/**
 * Pré-check de cota (best-effort, antes de subir): lança 413 se o usuário JÁ
 * atingiu o teto — evita subir um arquivo que com certeza será rejeitado. O
 * enforcement AUTORITATIVO (à prova de corrida) é feito dentro do lock no insert.
 */
async function assertQuotaAvailable(userId: string): Promise<void> {
  const used = await sumUserActiveMediaBytes(userId)
  // `>=` (não `>`): aqui ainda não sabemos o tamanho do arquivo, então rejeita
  // quem JÁ está no teto. O check autoritativo no lock usa `used + bytes > max`.
  if (used >= env.CHAT_USER_STORAGE_QUOTA_BYTES) {
    throw new AppError(413, 'STORAGE_QUOTA_EXCEEDED')
  }
}

/**
 * Cria o anexo (com cota ATÔMICA no lock) para mídia de upload do BACKEND
 * (imagem/áudio). O asset tem key ÚNICO desta request, então em qualquer falha
 * do insert é seguro removê-lo. Converte cota estourada em 413 e corrida de
 * idempotência na mensagem existente. No sucesso, publica ao vivo e devolve shaped.
 */
async function createBackendMediaMessage(
  conversationId: string,
  userId: string,
  participantIds: string[],
  attachment: Parameters<typeof createAttachmentMessage>[3],
  idempotencyKey: string | undefined,
  additionalBytes: number,
) {
  let message: MessageRow
  try {
    message = await createAttachmentMessage(
      conversationId,
      userId,
      null,
      attachment,
      idempotencyKey,
      env.CHAT_USER_STORAGE_QUOTA_BYTES,
      additionalBytes,
    )
  } catch (err) {
    await deleteChatMedia(attachment.key, logger)
    if (err instanceof QuotaExceededError) {
      throw new AppError(413, 'STORAGE_QUOTA_EXCEEDED')
    }
    const dup = await resolveIdempotencyConflict(
      err,
      conversationId,
      userId,
      idempotencyKey,
    )
    if (dup) return dup // existente: não republica
    throw err
  }
  await publishMessage(conversationId, participantIds, message)
  return shapeMessage(message)
}

export async function sendImageMessage(
  userId: string,
  conversationId: string,
  buffer: Buffer,
  idempotencyKey?: string,
) {
  const participantIds = await authorizeSend(conversationId, userId)
  const existing = await findIdempotentMessage(
    conversationId,
    userId,
    idempotencyKey,
  )
  if (existing) return existing // retry: nem faz upload
  await assertQuotaAvailable(userId) // pré best-effort: já cheio → nem sobe
  const uploaded = await uploadMessageImage(buffer, conversationId)
  return createBackendMediaMessage(
    conversationId,
    userId,
    participantIds,
    {
      kind: 'IMAGE',
      url: uploaded.url,
      key: uploaded.key,
      format: uploaded.format,
      size: uploaded.size,
      width: uploaded.width,
      height: uploaded.height,
    },
    idempotencyKey,
    uploaded.size,
  )
}

export async function sendAudioMessage(
  userId: string,
  conversationId: string,
  file: Readable & { truncated?: boolean },
  mimetype: string,
  meta: AudioMessageMeta,
  idempotencyKey?: string,
) {
  let participantIds: string[]
  try {
    participantIds = await authorizeSend(conversationId, userId)
    const existing = await findIdempotentMessage(
      conversationId,
      userId,
      idempotencyKey,
    )
    if (existing) {
      file.resume() // retry: não vamos consumir/subir o áudio — drena o stream
      return existing
    }
    await assertQuotaAvailable(userId) // pré best-effort: já cheio → 413 sem subir
  } catch (err) {
    // Barramos/erramos ANTES de consumir o arquivo: drena o stream pra não
    // deixar a conexão pendurada (o multipart espera o corpo ser lido). Cobre
    // autorização, lookup de idempotência e cota.
    file.resume()
    throw err
  }
  const uploaded = await uploadMessageAudio(file, conversationId, mimetype)
  return createBackendMediaMessage(
    conversationId,
    userId,
    participantIds,
    {
      kind: 'AUDIO',
      url: uploaded.url,
      key: uploaded.key,
      format: uploaded.format,
      size: uploaded.size,
      durationMs: meta.durationMs,
      waveform: meta.waveform ?? [],
    },
    idempotencyKey,
    uploaded.size,
  )
}

/** Pasta determinística que isola os anexos de cada conversa no R2. */
function conversationFolder(conversationId: string) {
  return `conversations/${conversationId}`
}

/**
 * Assina um PUT para o cliente subir o vídeo DIRETO ao R2. Exige participante
 * ativo (e, em DM, ausência de bloqueio) — a key devolvida já vem travada na
 * pasta desta conversa (definida pelo servidor, não pelo cliente).
 */
export async function createVideoUploadSignature(
  userId: string,
  conversationId: string,
  mimetype: string,
) {
  await authorizeSend(conversationId, userId)
  return getStorage().signUpload(conversationFolder(conversationId), mimetype)
}

type SendVideoInput = {
  key: string
  durationMs?: number
  width?: number
  height?: number
  posterBuffer?: Buffer
}

/**
 * Cria a mensagem de vídeo a partir da key que o cliente subiu direto ao R2
 * (upload assinado). NÃO confia no cliente: busca o asset no provider (fonte
 * da verdade), exige que a key esteja na pasta DESTA conversa e valida
 * formato/tamanho server-side. O poster (se enviado) é processado pelo
 * pipeline de imagem do chat e vira um objeto próprio no storage.
 */
export async function sendVideoMessage(
  userId: string,
  conversationId: string,
  input: SendVideoInput,
  idempotencyKey?: string,
) {
  const participantIds = await authorizeSend(conversationId, userId)
  const existing = await findIdempotentMessage(
    conversationId,
    userId,
    idempotencyKey,
  )
  if (existing) return existing
  // A key é definida pelo SERVIDOR na assinatura (trava a pasta na conversa):
  // um prefixo diferente não pode pertencer a esta conversa.
  const folder = conversationFolder(conversationId)
  if (!input.key.startsWith(`${folder}/`)) {
    throw new AppError(403, 'VIDEO_NOT_IN_CONVERSATION')
  }
  const asset = await getStorage().getAsset(input.key)
  if (!asset) {
    throw new AppError(400, 'VIDEO_NOT_FOUND')
  }
  assertVideoFormat(asset.format)
  if (asset.bytes > MAX_VIDEO_SIZE) {
    throw new AppError(413, 'FILE_TOO_LARGE', undefined, { maxMb: 50 })
  }
  let thumbnailKey: string | null = null
  if (input.posterBuffer) {
    const poster = await uploadMessageImage(input.posterBuffer, conversationId)
    thumbnailKey = poster.key
  }
  let thumbnailKey: string | null = null
  if (input.posterBuffer) {
    const poster = await uploadMessageImage(input.posterBuffer, conversationId)
    thumbnailKey = poster.key
  }
  let message: MessageRow
  try {
    // A cota é verificada DENTRO do lock no insert (asset.bytes como adicional).
    message = await createAttachmentMessage(
      conversationId,
      userId,
      null,
      {
        kind: 'VIDEO',
        url: getStorage().signedUrl(input.key),
        key: input.key,
        format: asset.format,
        size: asset.bytes,
        // Duração/dimensões vêm do CLIENTE, não do provider (cosmético — mesmo
        // precedente do áudio): o vídeo sobe direto ao R2, sem passar por um
        // processador que as extraia server-side.
        durationMs: input.durationMs ?? null,
        width: input.width ?? null,
        height: input.height ?? null,
        thumbnailUrl: null,
        thumbnailKey,
      },
      idempotencyKey,
      env.CHAT_USER_STORAGE_QUOTA_BYTES,
      asset.bytes,
    )
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      // O vídeo (subido pelo cliente) e o poster (se houver) viraram órfãos.
      await deleteChatMedia(input.key, logger)
      if (thumbnailKey) await deleteChatMedia(thumbnailKey, logger)
      throw new AppError(413, 'STORAGE_QUOTA_EXCEEDED')
    }
    // Corrida de idempotência: devolve a vencedora SEM deletar o vídeo — o
    // retry do cliente reusa a MESMA key da assinatura original, então
    // deletá-la quebraria a mensagem vencedora. O poster desta request, porém,
    // é um objeto próprio (órfão da perdedora) e sempre é deletado.
    const dup = await resolveIdempotencyConflict(
      err,
      conversationId,
      userId,
      idempotencyKey,
    )
    if (dup) {
      if (thumbnailKey) await deleteChatMedia(thumbnailKey, logger)
      return dup
    }
    // Falha não-idempotência → vídeo e poster viraram órfãos: limpa os dois.
    await deleteChatMedia(input.key, logger)
    if (thumbnailKey) await deleteChatMedia(thumbnailKey, logger)
    throw err
  }
  await publishMessage(conversationId, participantIds, message)
  return shapeMessage(message)
}

export async function markAsRead(userId: string, conversationId: string) {
  await assertActiveParticipant(conversationId, userId)
  const at = await markConversationRead(conversationId, userId)
  await publishReceipt('read', conversationId, userId, at)
}

export async function markDelivered(userId: string, conversationId: string) {
  await assertActiveParticipant(conversationId, userId)
  const at = await markConversationDelivered(conversationId, userId)
  await publishReceipt('delivered', conversationId, userId, at)
}

/** Anuncia o recibo (entregue/lido) aos outros participantes em tempo real. */
async function publishReceipt(
  type: 'delivered' | 'read',
  conversationId: string,
  userId: string,
  at: Date,
) {
  const participantIds = await findActiveParticipantUserIds(conversationId)
  const base = { conversationId, participantIds, at: at.toISOString() }
  // `delivered` é agregado no canal (userIds) — aqui o lote tem 1 usuário.
  await realtime.publish(
    type === 'delivered'
      ? { type, ...base, userIds: [userId] }
      : { type, ...base, userId },
  )
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
    throw new AppError(404, 'MESSAGE_NOT_FOUND')
  }
  if (message.type === 'SYSTEM') {
    throw new AppError(403, 'SYSTEM_MESSAGE_IMMUTABLE')
  }
  // Só o autor edita (admin de grupo NÃO edita msg alheia — diferente do delete).
  if (message.senderId !== userId) {
    throw new AppError(403, 'NOT_MESSAGE_AUTHOR')
  }
  if (message.deletedAt !== null) {
    throw new AppError(403, 'MESSAGE_DELETED')
  }
  // Mídia não é editável. Depois da cifra a ausência de texto só se prova pelas
  // DUAS colunas: a nova grava em contentCipher e deixa content nulo.
  if (message.content === null && message.contentCipher === null) {
    throw new AppError(403, 'MESSAGE_NOT_EDITABLE')
  }
  const encrypted = await encryptContent(conversationId, content)
  let updated: MessageRow
  try {
    updated = await editMessageContent(messageId, encrypted)
  } catch (err) {
    // Corrida: um DELETE concorrente apagou a mensagem (P2025). Mesmo contrato
    // do check de deletedAt acima — não edita tombstone.
    if (isRecordNotFound(err)) {
      throw new AppError(403, 'MESSAGE_DELETED')
    }
    throw err
  }
  await hydrateMessage(updated)
  await publishEditedMessage(conversationId, updated)
  return shapeMessage(updated)
}

async function loadMessageInConversation(
  conversationId: string,
  messageId: string,
) {
  const message = await findMessageById(messageId)
  if (!message || message.conversationId !== conversationId) {
    throw new AppError(404, 'MESSAGE_NOT_FOUND')
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
    throw new AppError(403, 'SYSTEM_MESSAGE_IMMUTABLE')
  }
  if (message.deletedAt !== null) {
    throw new AppError(403, 'MESSAGE_DELETED')
  }
  await addMessageReaction(messageId, userId, emoji)
  const updated = await findMessageWithConversation(messageId)
  if (!updated) {
    throw new AppError(404, 'MESSAGE_NOT_FOUND')
  }
  await hydrateMessage(updated)
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
    throw new AppError(404, 'MESSAGE_NOT_FOUND')
  }
  await hydrateMessage(updated)
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
    throw new AppError(404, 'MESSAGE_NOT_FOUND')
  }
  if (message.type === 'SYSTEM') {
    throw new AppError(403, 'SYSTEM_MESSAGE_IMMUTABLE')
  }
  if (message.senderId !== userId && participant.role !== 'ADMIN') {
    throw new AppError(403, 'NOT_MESSAGE_AUTHOR')
  }
  if (message.deletedAt !== null) return // já apagada — idempotente
  await softDeleteMessage(messageId)
  // Remove os arquivos no storage (best-effort): a falha de storage NÃO reverte
  // o soft-delete. Sem isso, áudio/imagem/vídeo apagados viram lixo pago eterno.
  const attachments = await findMessageAttachments(messageId)
  for (const att of attachments) {
    await deleteChatMedia(att.key, logger)
    // Poster de vídeo é objeto próprio no storage (key separada do vídeo).
    if (att.thumbnailKey) await deleteChatMedia(att.thumbnailKey, logger)
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
    throw new AppError(409, 'ALREADY_MEMBER')
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
    throw new AppError(400, 'USE_LEAVE_GROUP')
  }
  const result = await deactivateParticipant(conversationId, targetId)
  if (result.count === 0) {
    throw new AppError(404, 'PARTICIPANT_NOT_FOUND')
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
    throw new AppError(404, 'PARTICIPANT_NOT_FOUND')
  }
  await setParticipantRole(conversationId, targetId, role)
  return getConversation(userId, conversationId)
}
