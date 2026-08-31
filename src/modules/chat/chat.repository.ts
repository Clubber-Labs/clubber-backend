import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import type { EncryptedContent } from './chat.crypto'

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
      thumbnailKey: true,
      order: true,
    },
  },
  reactions: { select: { userId: true, emoji: true } },
  replyTo: {
    select: {
      id: true,
      senderId: true,
      // content/contentCipher/contentKeyVersion: a leitura dual do preview é
      // resolvida pelo hydrateMessages junto com a da mensagem — mesma conversa,
      // mesma DEK, custo zero.
      content: true,
      contentCipher: true,
      contentKeyVersion: true,
      deletedAt: true,
      sender: { select: userSelect },
    },
  },
} as const

/**
 * Participantes ativos em ordem TOTAL — a ordem é contrato da API (o app
 * renderiza o array como veio). joinedAt sozinho empata: na criação do grupo,
 * criador e membros iniciais nascem na mesma transação (now()), então o userId
 * fecha o desempate. Compartilhado pelos includes para não divergirem.
 */
const activeParticipantsInclude = {
  where: { leftAt: null },
  orderBy: [{ joinedAt: 'asc' as const }, { userId: 'asc' as const }],
  include: { user: { select: userSelect } },
}

/** Chave determinística do par DIRECT (uuids ordenados). */
export function directKeyFor(a: string, b: string) {
  return [a, b].sort().join(':')
}

// ── Chaves de conversa (envelope encryption) ─────────────────────────────────
// Persistem bytes opacos: quem envelopa/desembrulha é o chat.crypto.

const conversationKeySelect = {
  version: true,
  wrappedDek: true,
  kekVersion: true,
} as const

/** Chave vigente: a de maior versão ainda não aposentada. */
export async function findActiveConversationKey(conversationId: string) {
  return prisma.conversationKey.findFirst({
    where: { conversationId, retiredAt: null },
    orderBy: { version: 'desc' },
    select: conversationKeySelect,
  })
}

/** Versão específica — mensagem antiga aponta para a chave com que foi cifrada. */
export async function findConversationKey(
  conversationId: string,
  version: number,
) {
  return prisma.conversationKey.findUnique({
    where: { conversationId_version: { conversationId, version } },
    select: conversationKeySelect,
  })
}

export async function createConversationKey(
  conversationId: string,
  version: number,
  wrapped: { kekVersion: number; blob: Buffer },
) {
  return prisma.conversationKey.create({
    data: {
      conversationId,
      version,
      wrappedDek: new Uint8Array(wrapped.blob),
      kekVersion: wrapped.kekVersion,
    },
    select: conversationKeySelect,
  })
}

/**
 * Pendentes de rewrap: o predicado `kekVersion < ativa` é o próprio cursor — a
 * linha sai do conjunto ao ser reembrulhada, então o varredor é idempotente e
 * retomável sem estado. Chave APOSENTADA entra (ainda decifra histórico); só a
 * shreddada fica de fora, porque não há segredo para reembrulhar.
 */
export async function findConversationKeysToRewrap(
  activeVersion: number,
  limit: number,
) {
  return prisma.conversationKey.findMany({
    where: {
      kekVersion: { lt: activeVersion },
      shreddedAt: null,
      // Blob vazio nunca vira rewrap: sem este filtro a linha ficaria
      // presa no predicado e o lote a releria para sempre.
      wrappedDek: { not: new Uint8Array(0) },
    },
    orderBy: [{ kekVersion: 'asc' }, { id: 'asc' }],
    take: limit,
    select: {
      id: true,
      conversationId: true,
      wrappedDek: true,
      kekVersion: true,
    },
  })
}

export async function countConversationKeysToRewrap(activeVersion: number) {
  return prisma.conversationKey.groupBy({
    by: ['kekVersion'],
    where: {
      kekVersion: { lt: activeVersion },
      shreddedAt: null,
      // Mesmo predicado do find acima: contagem e drenagem não podem divergir.
      wrappedDek: { not: new Uint8Array(0) },
    },
    _count: { _all: true },
  })
}

/**
 * Envelope e versão gravam JUNTOS, e o `kekVersion` no WHERE é o compare-and-set
 * que torna seguro rodar o reconciler em N réplicas sem lock distribuído.
 */
export async function updateConversationKeyEnvelope(
  id: string,
  fromKekVersion: number,
  wrapped: { kekVersion: number; blob: Buffer },
) {
  const { count } = await prisma.conversationKey.updateMany({
    where: { id, kekVersion: fromKekVersion },
    data: {
      wrappedDek: new Uint8Array(wrapped.blob),
      kekVersion: wrapped.kekVersion,
    },
  })
  return count
}

export async function findUserBrief(id: string) {
  // accountStatus e isPrivate só aqui (não no userSelect compartilhado): a
  // checagem de alcançabilidade precisa dos dois, sem alterar o shape de mensagens.
  return prisma.user.findUnique({
    where: { id },
    select: { ...userSelect, accountStatus: true, isPrivate: true },
  })
}

export async function findDirectByKey(directKey: string) {
  return prisma.conversation.findUnique({
    where: { directKey },
    include: {
      participants: activeParticipantsInclude,
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
      participants: activeParticipantsInclude,
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
      participants: activeParticipantsInclude,
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
      participants: activeParticipantsInclude,
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
      participants: activeParticipantsInclude,
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
  content: EncryptedContent,
  replyToId?: string,
  idempotencyKey?: string,
) {
  const [message] = await prisma.$transaction([
    prisma.message.create({
      data: {
        conversationId,
        senderId,
        // `content` (plaintext) fica nulo: só o legado pré-backfill o preenche.
        contentCipher: content.cipher,
        contentKeyVersion: content.keyVersion,
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
  // Vídeo: poster (upload do app). thumbnailUrl só preenchido por anexo legado
  // do Cloudinary (ver shapeAttachments); mídia nova usa thumbnailKey.
  thumbnailUrl?: string | null
  thumbnailKey?: string | null
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
  content: EncryptedContent | null,
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
        contentCipher: content?.cipher ?? null,
        contentKeyVersion: content?.keyVersion ?? null,
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
              thumbnailKey: attachment.thumbnailKey ?? null,
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
      // Os três juntos: o service decide "é mensagem de texto?" (editável) pela
      // ausência de AMBOS — plaintext legado e ciphertext.
      content: true,
      contentCipher: true,
      contentKeyVersion: true,
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
  content: EncryptedContent,
) {
  const [message] = await prisma.$transaction([
    prisma.message.create({
      // Mensagem de sistema TAMBÉM cifra: ela carrega nomes de usuários, que em
      // claro no dump anulariam metade do ganho.
      data: {
        conversationId,
        senderId: actorId,
        contentCipher: content.cipher,
        contentKeyVersion: content.keyVersion,
        type: 'SYSTEM',
      },
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

export async function editMessageContent(
  id: string,
  content: EncryptedContent,
) {
  // `deletedAt: null` no where torna a edição atômica: se um DELETE concorrente
  // apagar a mensagem entre o check do service e aqui, o update não encontra a
  // linha e lança P2025 (tratado no service) — em vez de editar um tombstone.
  return prisma.message.update({
    where: { id, deletedAt: null },
    data: {
      contentCipher: content.cipher,
      contentKeyVersion: content.keyVersion,
      // Zera o plaintext legado: editar uma mensagem pré-backfill não pode
      // deixar a versão antiga em claro na linha.
      content: null,
      editedAt: new Date(),
    },
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

/** Anexos (key + kind + thumbnailKey) de uma mensagem — para limpar o storage
 * ao apagá-la (vídeo tem um poster em key própria). */
/**
 * Conversa com TODOS os participantes, inclusive os que saíram — ao contrário
 * de findConversationWithParticipants, que filtra `leftAt: null`. Num snapshot
 * de denúncia, quem saiu do grupo depois de agredir é exatamente quem precisa
 * constar.
 */
export async function findConversationForEvidence(id: string) {
  return prisma.conversation.findUnique({
    where: { id },
    select: {
      id: true,
      type: true,
      title: true,
      participants: {
        orderBy: [{ joinedAt: 'asc' as const }, { userId: 'asc' as const }],
        select: {
          userId: true,
          leftAt: true,
          user: { select: { username: true } },
        },
      },
    },
  })
}

/**
 * Janela de contexto ao redor de uma mensagem, para o snapshot de denúncia.
 * Ordena por (createdAt, id) — o mesmo par estável usado no resto do módulo,
 * porque createdAt sozinho empata em envios simultâneos.
 *
 * Traz mensagens apagadas de propósito: o snapshot registra o que existia no
 * instante da denúncia, e `deletedAt` acompanha cada linha.
 */
export async function findMessagesAround(
  conversationId: string,
  messageId: string,
  before: number,
  after: number,
) {
  const pivot = await prisma.message.findUnique({
    where: { id: messageId },
    select: { createdAt: true },
  })
  if (!pivot) return []

  const olderThanPivot = {
    conversationId,
    OR: [
      { createdAt: { lt: pivot.createdAt } },
      { createdAt: pivot.createdAt, id: { lt: messageId } },
    ],
  }
  const newerThanPivot = {
    conversationId,
    OR: [
      { createdAt: { gt: pivot.createdAt } },
      { createdAt: pivot.createdAt, id: { gt: messageId } },
    ],
  }

  const [antes, alvo, depois] = await Promise.all([
    before === 0
      ? []
      : prisma.message.findMany({
          where: olderThanPivot,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: before,
          include: messageInclude,
        }),
    prisma.message.findMany({
      where: { id: messageId },
      include: messageInclude,
    }),
    after === 0
      ? []
      : prisma.message.findMany({
          where: newerThanPivot,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: after,
          include: messageInclude,
        }),
  ])

  return [...antes.reverse(), ...alvo, ...depois]
}

export async function findMessageAttachments(messageId: string) {
  return prisma.messageAttachment.findMany({
    where: { messageId },
    select: { key: true, kind: true, thumbnailKey: true },
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
 * Marca entrega em LOTE: avança o lastDeliveredAt de todos os `userIds` que
 * ainda não receberam até `upTo` (createdAt da mensagem), num único UPDATE.
 * Mantém o watermark monotônico por participante e devolve só quem realmente
 * avançou (quem já cobria fica de fora — evita frame redundante), ou null se
 * ninguém avançou. Usado na marcação server-side ao entregar pelo socket: numa
 * mensagem de grupo, N destinatários locais viram 1 escrita, não N.
 */
export async function markDeliveredBatchIfBehind(
  conversationId: string,
  userIds: string[],
  upTo: Date,
): Promise<{ userIds: string[]; at: Date } | null> {
  if (userIds.length === 0) return null
  // max(now, upTo): o watermark gravado sempre COBRE a mensagem. `upTo` vem do
  // relógio do banco (createdAt) e `now` do da app — se a app estiver atrás,
  // gravar só `now` deixaria o lote re-executável (evento delivered duplicado).
  const now = new Date()
  const at = now.getTime() >= upTo.getTime() ? now : upTo
  // Subquery com ORDER BY + FOR UPDATE: os row locks são adquiridos em ordem
  // determinística de userId (LockRows roda acima do Sort). Sem isso, dois
  // lotes concorrentes sobrepostos podem travar em ordens diferentes — o
  // planner alterna entre Index Scan (ordem do índice) e Bitmap Heap Scan
  // (ordem física) conforme o tamanho do IN — e deadlockar (40P01).
  const rows = await prisma.$queryRaw<{ userid: string }[]>(
    Prisma.sql`
      UPDATE conversation_participants cp
      SET "lastDeliveredAt" = ${at}
      FROM (
        SELECT id
        FROM conversation_participants
        WHERE "conversationId" = ${conversationId}
          AND "userId" IN (${Prisma.join(userIds)})
          AND "leftAt" IS NULL
          AND ("lastDeliveredAt" IS NULL OR "lastDeliveredAt" < ${upTo})
        ORDER BY "userId"
        FOR UPDATE
      ) locked
      WHERE cp.id = locked.id
      RETURNING cp."userId" AS userid
    `,
  )
  if (rows.length === 0) return null
  return { userIds: rows.map((r) => r.userid), at }
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

/**
 * Passa o ADMIN adiante quando não sobrou nenhum ativo: promove o participante
 * mais antigo, na mesma ordem de entrada da lista (joinedAt, userId — ver
 * activeParticipantsInclude). Devolve quem assumiu, ou null se o grupo ainda
 * tem admin, esvaziou de vez, ou outra saída simultânea já passou o bastão.
 */
export async function promoteOldestParticipantIfNoAdmin(
  conversationId: string,
): Promise<string | null> {
  return prisma.$transaction(async (tx) => {
    const admin = await tx.conversationParticipant.findFirst({
      where: { conversationId, leftAt: null, role: 'ADMIN' },
      select: { id: true },
    })
    if (admin) return null

    const oldest = await tx.conversationParticipant.findFirst({
      where: { conversationId, leftAt: null },
      orderBy: [{ joinedAt: 'asc' }, { userId: 'asc' }],
      select: { userId: true },
    })
    if (!oldest) return null

    // O `role: MEMBER` no WHERE é o que resolve duas saídas de admin ao mesmo
    // tempo: sob Read Committed o segundo UPDATE espera o primeiro e reavalia a
    // condição contra a linha JÁ promovida — não casa, count 0, e o grupo não
    // ouve a mesma promoção duas vezes. Guard no write, sem lock: o ato é uma
    // linha só (diferente da quota de anexos, que soma várias).
    const promoted = await tx.conversationParticipant.updateMany({
      where: {
        conversationId,
        userId: oldest.userId,
        leftAt: null,
        role: 'MEMBER',
      },
      data: { role: 'ADMIN' },
    })
    return promoted.count === 0 ? null : oldest.userId
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

/**
 * Teto da contagem de não-lidas. Sem ele o COUNT varre TODAS as mensagens desde
 * o lastReadAt — quem fica dias fora de um grupo ativo paga esse scan a cada
 * abertura do inbox. O app já renderiza "99+" acima de 99, então saturar em 100
 * é invisível na UI.
 */
export const UNREAD_COUNT_CAP = 100

/** Não-lidas por conversa (batch, 1 query) — mensagens de outros após lastReadAt,
 * saturadas em UNREAD_COUNT_CAP. */
export async function unreadCounts(
  userId: string,
  conversationIds: string[],
): Promise<Map<string, number>> {
  if (conversationIds.length === 0) return new Map()
  const rows = await prisma.$queryRaw<
    { conversationid: string; unread: number }[]
  >(
    Prisma.sql`
      SELECT p."conversationId" AS conversationid, capped.unread
      FROM conversation_participants p
      CROSS JOIN LATERAL (
        -- LIMIT dentro do subselect: o índice (conversationId, createdAt) para
        -- de varrer ao juntar o teto, em vez de contar a conversa inteira.
        SELECT COUNT(*)::int AS unread
        FROM (
          SELECT 1
          FROM messages m
          WHERE m."conversationId" = p."conversationId"
            AND m."senderId" <> ${userId}
            AND m."deletedAt" IS NULL
            AND m."type" <> 'SYSTEM'
            AND (p."lastReadAt" IS NULL OR m."createdAt" > p."lastReadAt")
          LIMIT ${UNREAD_COUNT_CAP}
        ) top
      ) capped
      WHERE p."userId" = ${userId}
        AND p."conversationId" IN (${Prisma.join(conversationIds)})
    `,
  )
  return new Map(rows.map((r) => [r.conversationid, Number(r.unread)]))
}
