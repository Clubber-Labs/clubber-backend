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
    select: { id: true, url: true, format: true, size: true, order: true },
  },
} as const

/** Chave determinística do par DIRECT (uuids ordenados). */
export function directKeyFor(a: string, b: string) {
  return [a, b].sort().join(':')
}

export async function findUserBrief(id: string) {
  return prisma.user.findUnique({ where: { id }, select: userSelect })
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
) {
  const [message] = await prisma.$transaction([
    prisma.message.create({
      data: { conversationId, senderId, content },
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

export async function createImageMessage(
  conversationId: string,
  senderId: string,
  content: string | null,
  attachment: { url: string; key: string; format: string; size: number },
) {
  const [message] = await prisma.$transaction([
    prisma.message.create({
      data: {
        conversationId,
        senderId,
        content,
        attachments: { create: [{ ...attachment, order: 0 }] },
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
      content: true,
      deletedAt: true,
    },
  })
}

export async function editMessageContent(id: string, content: string) {
  return prisma.message.update({
    where: { id },
    data: { content, editedAt: new Date() },
    include: messageInclude,
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

export async function markConversationRead(
  conversationId: string,
  userId: string,
) {
  return prisma.conversationParticipant.updateMany({
    where: { conversationId, userId },
    data: { lastReadAt: new Date() },
  })
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
        AND (p."lastReadAt" IS NULL OR m."createdAt" > p."lastReadAt")
      GROUP BY m."conversationId"
    `,
  )
  return new Map(rows.map((r) => [r.conversationid, Number(r.unread)]))
}
