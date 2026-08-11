import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'

const userSelect = {
  id: true,
  name: true,
  lastname: true,
  username: true,
  avatarUrl: true,
} as const

const messageInclude = {
  sender: { select: userSelect },
  attachments: {
    orderBy: { order: 'asc' as const },
    select: {
      id: true,
      kind: true,
      url: true,
      // key (publicId): interno, usado só para gerar a URL assinada no read.
      // NÃO é exposto na resposta — shapeMessage o descarta.
      key: true,
      format: true,
      size: true,
      durationMs: true,
      waveform: true,
      width: true,
      height: true,
      thumbnailUrl: true,
      order: true,
    },
  },
  reactions: { select: { userId: true, emoji: true } },
  replyTo: {
    select: {
      id: true,
      senderId: true,
      content: true,
      deletedAt: true,
      sender: { select: userSelect },
    },
  },
} as const

/** Chave determinística do par DIRECT (uuids ordenados). */
export function directKeyFor(a: string, b: string) {
  return [a, b].sort().join(':')
}

export async function findUserBrief(id: string) {
  // accountStatus só aqui (não no userSelect compartilhado) para a checagem de
  // alcançabilidade barrar contas inativas, sem alterar o shape de mensagens.
  return prisma.user.findUnique({
    where: { id },
    select: { ...userSelect, accountStatus: true },
  })
}

export async function findDirectByKey(directKey: string) {
  return prisma.conversation.findUnique({
    where: { directKey },
    include: {
      participants: {
        where: { leftAt: null },
        include: { user: { select: userSelect } },
      },
    },
  })
}

export async function createDirectConversation(
  creatorId: string,
  targetId: string,
) {
  return prisma.conversation.create({
    data: {
      type: 'DIRECT',
      createdById: creatorId,
      directKey: directKeyFor(creatorId, targetId),
      participants: {
        create: [{ userId: creatorId }, { userId: targetId }],
      },
    },
    include: {
      participants: {
        where: { leftAt: null },
        include: { user: { select: userSelect } },
      },
    },
  })
}

export async function createGroupConversation(
  creatorId: string,
  title: string,
  memberIds: string[],
) {
  return prisma.conversation.create({
    data: {
      type: 'GROUP',
      title,
      createdById: creatorId,
      participants: {
        create: [
          { userId: creatorId, role: 'ADMIN' },
          ...memberIds.map((userId) => ({ userId })),
        ],
      },
    },
    include: {
      participants: {
        where: { leftAt: null },
        include: { user: { select: userSelect } },
      },
    },
  })
}

export async function findConversationById(id: string) {
  return prisma.conversation.findUnique({
    where: { id },
    select: { id: true, type: true, title: true, createdById: true },
  })
}

export async function findConversationWithParticipants(id: string) {
  return prisma.conversation.findUnique({
    where: { id },
    include: {
      participants: {
        where: { leftAt: null },
        include: { user: { select: userSelect } },
      },
    },
  })
}

export async function findActiveParticipant(
  conversationId: string,
  userId: string,
) {
  return prisma.conversationParticipant.findFirst({
    where: { conversationId, userId, leftAt: null },
  })
}

export async function findParticipant(conversationId: string, userId: string) {
  return prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  })
}

export async function findActiveParticipantUserIds(conversationId: string) {
  const rows = await prisma.conversationParticipant.findMany({
    where: { conversationId, leftAt: null },
    select: { userId: true },
  })
  return rows.map((r) => r.userId)
}

/**
 * Participantes ativos que devem RECEBER os sinais efêmeros de `senderId`
 * (digitando) — exclui quem tem bloqueio em qualquer direção com ele. Espelha o
 * filtro de presença (findConversationPartnerIds): typing não atravessa
 * bloqueio. Separada de findActiveParticipantUserIds de propósito — aquela
 * alimenta o fan-out de mensagem/notificação, que tem regras de bloqueio
 * próprias e não deve herdar este filtro.
 */
export async function findTypingRecipientUserIds(
  conversationId: string,
  senderId: string,
) {
  const rows = await prisma.$queryRaw<{ userid: string }[]>(
    Prisma.sql`
      SELECT p."userId" AS userid
      FROM conversation_participants p
      WHERE p."conversationId" = ${conversationId}
        AND p."leftAt" IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM blocks b
          WHERE (b."blockerId" = ${senderId} AND b."blockedId" = p."userId")
             OR (b."blockerId" = p."userId" AND b."blockedId" = ${senderId})
        )
    `,
  )
  return rows.map((r) => r.userid)
}

/** Usuários que compartilham alguma conversa ativa com `userId` (para presença). */
export async function findConversationPartnerIds(userId: string) {
  const rows = await prisma.$queryRaw<{ userid: string }[]>(
    Prisma.sql`
      SELECT DISTINCT p2."userId" AS userid
      FROM conversation_participants p1
      JOIN conversation_participants p2
        ON p1."conversationId" = p2."conversationId"
      WHERE p1."userId" = ${userId}
        AND p1."leftAt" IS NULL
        AND p2."leftAt" IS NULL
        AND p2."userId" <> ${userId}
        -- Presença não atravessa bloqueio: num grupo compartilhado, um lado
        -- que bloqueou o outro não deve receber online/last-seen dele.
        AND NOT EXISTS (
          SELECT 1 FROM blocks b
          WHERE (b."blockerId" = ${userId} AND b."blockedId" = p2."userId")
             OR (b."blockerId" = p2."userId" AND b."blockedId" = ${userId})
        )
    `,
  )
  return rows.map((r) => r.userid)
}

/** Marca o usuário como "visto agora" (presença/last-seen); retorna o instante. */
export async function touchLastSeen(userId: string) {
  const now = new Date()
  await prisma.user.update({ where: { id: userId }, data: { lastSeenAt: now } })
  return now
}

export async function listInboxConversations(
  userId: string,
  limit: number,
  cursor?: string,
) {
  return prisma.conversation.findMany({
    where: {
      // Participante ativo e que não ocultou a conversa (clearedAt null).
      participants: { some: { userId, leftAt: null, clearedAt: null } },
      // Esconde DM que nunca teve mensagem; grupos aparecem mesmo vazios.
      // (tombstone conta como mensagem — a DM com msg apagada continua visível.)
      OR: [{ type: 'GROUP' }, { messages: { some: {} } }],
    },
    take: limit,
    ...(cursor && { skip: 1, cursor: { id: cursor } }),
    orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
    include: {
      participants: {
        where: { leftAt: null },
        include: { user: { select: userSelect } },
      },
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: messageInclude,
      },
    },
  })
}

export async function createTextMessage(
  conversationId: string,
  senderId: string,
  content: string,
  replyToId?: string,
  idempotencyKey?: string,
) {
  const [message] = await prisma.$transaction([
    prisma.message.create({
      data: {
        conversationId,
        senderId,
        content,
        replyToId: replyToId ?? null,
        idempotencyKey: idempotencyKey ?? null,
      },
      include: messageInclude,
    }),
    prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    }),
    // Mensagem nova "reabre" a conversa pra quem a tinha ocultado (clearedAt).
    prisma.conversationParticipant.updateMany({
      where: { conversationId, clearedAt: { not: null } },
      data: { clearedAt: null },
    }),
  ])
  return message
}

type AttachmentInput = {
  kind: 'IMAGE' | 'AUDIO' | 'VIDEO'
  url: string
  key: string
  format: string
  size: number
  // Áudio e vídeo preenchem durationMs; imagem deixa null. waveform é só áudio.
  durationMs?: number | null
  waveform?: number[]
  // Só vídeo preenche; imagem/áudio deixam null.
  width?: number | null
  height?: number | null
  // Vídeo: poster gerado pelo provider.
  thumbnailUrl?: string | null
}

/** Erro sentinela: a criação foi abortada (rollback) por estourar a cota. */
export class QuotaExceededError extends Error {
  constructor() {
    super('storage quota exceeded')
    this.name = 'QuotaExceededError'
  }
}

/**
 * Cria a mensagem-anexo de forma ATÔMICA com o enforcement de cota. Um advisory
 * lock POR REMETENTE serializa os envios concorrentes do MESMO usuário, então a
 * soma do uso + o check + o insert acontecem sem janela de corrida (TOCTOU) —
 * sem broker/fila, só Postgres. Usuários diferentes não se bloqueiam. Lança
 * QuotaExceededError (com rollback) se o novo arquivo estoura a cota.
 */
export async function createAttachmentMessage(
  conversationId: string,
  senderId: string,
  content: string | null,
  attachment: AttachmentInput,
  idempotencyKey: string | undefined,
  maxBytes: number,
  additionalBytes: number,
) {
  return prisma.$transaction(async (tx) => {
    // Lock por usuário, liberado no fim da transação (xact). Chave de 64 bits
    // derivada do md5 do senderId — hashtext() seria só int4 (32 bits) e dois
    // usuários distintos colidiriam (aniversário) serializando à toa. $executeRaw
    // (não $queryRaw): a função retorna void, não há resultado a desserializar.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(('x' || md5(${senderId}))::bit(64)::bigint)`
    const agg = await tx.messageAttachment.aggregate({
      _sum: { size: true },
      where: { message: { senderId, deletedAt: null } },
    })
    const used = agg._sum.size ?? 0
    if (used + additionalBytes > maxBytes) {
      throw new QuotaExceededError()
    }
    const message = await tx.message.create({
      data: {
        conversationId,
        senderId,
        content,
        idempotencyKey: idempotencyKey ?? null,
        attachments: {
          create: [
            {
              kind: attachment.kind,
              url: attachment.url,
              key: attachment.key,
              format: attachment.format,
              size: attachment.size,
              durationMs: attachment.durationMs ?? null,
              waveform: attachment.waveform ?? [],
              width: attachment.width ?? null,
              height: attachment.height ?? null,
              thumbnailUrl: attachment.thumbnailUrl ?? null,
              order: 0,
            },
          ],
        },
      },
      include: messageInclude,
    })
    await tx.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    })
    // Mensagem nova "reabre" a conversa pra quem a tinha ocultado (clearedAt).
    await tx.conversationParticipant.updateMany({
      where: { conversationId, clearedAt: { not: null } },
      data: { clearedAt: null },
    })
    return message
  })
}

/**
 * Soma de bytes de mídia ATIVA enviada por um usuário (anexos de mensagens não
 * apagadas). Base da cota de armazenamento — apagar mensagem libera o espaço.
 */
export async function sumUserActiveMediaBytes(userId: string): Promise<number> {
  const result = await prisma.messageAttachment.aggregate({
    _sum: { size: true },
    where: { message: { senderId: userId, deletedAt: null } },
  })
  return result._sum.size ?? 0
}

/** Idempotência: a mensagem já criada por (conversa, remetente, key), se houver. */
export async function findMessageByIdempotencyKey(
  conversationId: string,
  senderId: string,
  idempotencyKey: string,
) {
  return prisma.message.findUnique({
    where: {
      conversationId_senderId_idempotencyKey: {
        conversationId,
        senderId,
        idempotencyKey,
      },
    },
    include: messageInclude,
  })
}

export async function findConversationMessages(
  conversationId: string,
  limit: number,
  cursor?: string,
) {
  return prisma.message.findMany({
    where: { conversationId },
    take: limit,
    ...(cursor && { skip: 1, cursor: { id: cursor } }),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: messageInclude,
  })
}

export async function findMessageById(id: string) {
  return prisma.message.findUnique({
    where: { id },
    select: {
      id: true,
      conversationId: true,
      senderId: true,
      type: true,
      content: true,
      deletedAt: true,
    },
  })
}

/**
 * Cria uma mensagem de sistema (entrou/saiu/renomeou) atribuída ao ator que
 * disparou a ação. Mesmo padrão das mensagens normais: bumpa lastMessageAt e
 * reabre a conversa pra quem a tinha ocultado.
 */
export async function createSystemMessage(
  conversationId: string,
  actorId: string,
  content: string,
) {
  const [message] = await prisma.$transaction([
    prisma.message.create({
      data: { conversationId, senderId: actorId, content, type: 'SYSTEM' },
      include: messageInclude,
    }),
    prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    }),
    prisma.conversationParticipant.updateMany({
      where: { conversationId, clearedAt: { not: null } },
      data: { clearedAt: null },
    }),
  ])
  return message
}

export async function editMessageContent(id: string, content: string) {
  // `deletedAt: null` no where torna a edição atômica: se um DELETE concorrente
  // apagar a mensagem entre o check do service e aqui, o update não encontra a
  // linha e lança P2025 (tratado no service) — em vez de editar um tombstone.
  return prisma.message.update({
    where: { id, deletedAt: null },
    data: { content, editedAt: new Date() },
    include: messageInclude,
  })
}

export async function addMessageReaction(
  messageId: string,
  userId: string,
  emoji: string,
) {
  // Idempotente: re-reagir com o mesmo emoji não duplica nem falha.
  await prisma.messageReaction.upsert({
    where: { messageId_userId_emoji: { messageId, userId, emoji } },
    update: {},
    create: { messageId, userId, emoji },
  })
}

export async function removeMessageReaction(
  messageId: string,
  userId: string,
  emoji: string,
) {
  await prisma.messageReaction.deleteMany({
    where: { messageId, userId, emoji },
  })
}

export async function findMessageWithConversation(id: string) {
  return prisma.message.findUnique({
    where: { id },
    include: messageInclude,
  })
}

/** Anexos (key + kind) de uma mensagem — para limpar o storage ao apagá-la. */
export async function findMessageAttachments(messageId: string) {
  return prisma.messageAttachment.findMany({
    where: { messageId },
    select: { key: true, kind: true },
  })
}

/** Oculta a conversa para um participante (DELETE /conversations/:id). */
export async function clearConversationForParticipant(
  conversationId: string,
  userId: string,
) {
  return prisma.conversationParticipant.updateMany({
    where: { conversationId, userId },
    data: { clearedAt: new Date() },
  })
}

export async function softDeleteMessage(id: string) {
  return prisma.message.update({
    where: { id },
    data: { deletedAt: new Date() },
  })
}

/** Avança leitura (e entrega junto) do participante; devolve o watermark aplicado. */
export async function markConversationRead(
  conversationId: string,
  userId: string,
): Promise<Date> {
  const now = new Date()
  // Quem lê também recebeu: avança lastDeliveredAt junto (read implica delivered).
  await prisma.conversationParticipant.updateMany({
    where: { conversationId, userId, leftAt: null },
    data: { lastReadAt: now, lastDeliveredAt: now },
  })
  return now
}

/** Avança a entrega do participante; devolve o watermark aplicado. */
export async function markConversationDelivered(
  conversationId: string,
  userId: string,
): Promise<Date> {
  const now = new Date()
  await prisma.conversationParticipant.updateMany({
    where: { conversationId, userId, leftAt: null },
    data: { lastDeliveredAt: now },
  })
  return now
}

/**
 * Marca entrega só se o participante ainda não recebeu até `upTo` (createdAt da
 * mensagem). Mantém o watermark monotônico e evita frame redundante quando ele
 * já leu/recebeu além dessa mensagem. Devolve o novo watermark, ou null se nada
 * avançou. Usado na marcação server-side ao entregar a mensagem pelo socket.
 */
export async function markDeliveredIfBehind(
  conversationId: string,
  userId: string,
  upTo: Date,
): Promise<Date | null> {
  const now = new Date()
  const res = await prisma.conversationParticipant.updateMany({
    where: {
      conversationId,
      userId,
      leftAt: null,
      OR: [{ lastDeliveredAt: null }, { lastDeliveredAt: { lt: upTo } }],
    },
    data: { lastDeliveredAt: now },
  })
  return res.count > 0 ? now : null
}

export async function reactivateParticipant(
  conversationId: string,
  userId: string,
) {
  return prisma.conversationParticipant.upsert({
    where: { conversationId_userId: { conversationId, userId } },
    update: { leftAt: null, role: 'MEMBER' },
    create: { conversationId, userId },
  })
}

export async function deactivateParticipant(
  conversationId: string,
  userId: string,
) {
  return prisma.conversationParticipant.updateMany({
    where: { conversationId, userId, leftAt: null },
    data: { leftAt: new Date() },
  })
}

export async function setParticipantRole(
  conversationId: string,
  userId: string,
  role: 'MEMBER' | 'ADMIN',
) {
  return prisma.conversationParticipant.updateMany({
    where: { conversationId, userId, leftAt: null },
    data: { role },
  })
}

export async function renameConversation(id: string, title: string) {
  return prisma.conversation.update({ where: { id }, data: { title } })
}

/** Apaga a conversa (cascade em participants/messages/attachments/reactions).
 * deleteMany = idempotente (sem P2025 se já removida). */
export async function deleteConversation(id: string): Promise<number> {
  const res = await prisma.conversation.deleteMany({ where: { id } })
  return res.count
}

/** Não-lidas por conversa (batch, 1 query) — mensagens de outros após lastReadAt. */
export async function unreadCounts(
  userId: string,
  conversationIds: string[],
): Promise<Map<string, number>> {
  if (conversationIds.length === 0) return new Map()
  const rows = await prisma.$queryRaw<
    { conversationid: string; unread: number }[]
  >(
    Prisma.sql`
      SELECT m."conversationId" AS conversationid, COUNT(*)::int AS unread
      FROM messages m
      JOIN conversation_participants p
        ON p."conversationId" = m."conversationId" AND p."userId" = ${userId}
      WHERE m."conversationId" IN (${Prisma.join(conversationIds)})
        AND m."senderId" <> ${userId}
        AND m."deletedAt" IS NULL
        AND m."type" <> 'SYSTEM'
        AND (p."lastReadAt" IS NULL OR m."createdAt" > p."lastReadAt")
      GROUP BY m."conversationId"
    `,
  )
  return new Map(rows.map((r) => [r.conversationid, Number(r.unread)]))
}
