import type { NotificationType } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'

export type CreateNotificationInput = {
  userId: string
  type: NotificationType
  actorId?: string | null
  eventId?: string | null
  postId?: string | null
  commentId?: string | null
  title: string
  body: string
  data?: Prisma.InputJsonValue
  dedupeKey: string
}

export type NotificationCursor = { createdAt: Date; id: string }

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  )
}

/**
 * Cria a notificação ou retorna `null` se já existe (unique userId+dedupeKey).
 * O `null` sinaliza "duplicada" — o caller pula a entrega em foreground/push,
 * tornando o fan-out idempotente sob retry ou duplo gatilho. Mesma técnica do
 * resolveIdempotencyConflict do chat (catch P2002), sem propagar o erro.
 */
export async function createNotificationIfNew(input: CreateNotificationInput) {
  try {
    return await prisma.notification.create({ data: input })
  } catch (err) {
    if (isUniqueViolation(err)) return null
    throw err
  }
}

/**
 * Lista as notificações do usuário, mais recentes primeiro, por keyset
 * (createdAt, id) — estável sob inserções entre páginas, como o feed.
 */
export async function listNotifications(
  userId: string,
  limit: number,
  cursor?: NotificationCursor,
) {
  return prisma.notification.findMany({
    where: {
      userId,
      ...(cursor && {
        OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ],
      }),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
  })
}

/**
 * Marca uma notificação como lida. updateMany com userId no where garante
 * ownership (não vaza/altera notificação de outro usuário). Retorna a contagem
 * afetada — 0 quando não existe, não é do usuário, ou já estava lida.
 */
export async function markNotificationRead(userId: string, id: string) {
  const result = await prisma.notification.updateMany({
    where: { id, userId, readAt: null },
    data: { readAt: new Date() },
  })
  return result.count
}

export async function markAllNotificationsRead(userId: string) {
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  })
  return result.count
}

export async function countUnreadNotifications(userId: string) {
  return prisma.notification.count({ where: { userId, readAt: null } })
}

/** Confirma se a notificação existe e pertence ao usuário (sem vazar conteúdo). */
export async function notificationExists(userId: string, id: string) {
  const found = await prisma.notification.findFirst({
    where: { id, userId },
    select: { id: true },
  })
  return found !== null
}

/**
 * Cria várias notificações de uma vez, pulando duplicatas (unique userId+dedupeKey).
 * Base do fan-out de proximidade. Retorna quantas foram efetivamente criadas.
 */
export async function createManyNotifications(
  inputs: CreateNotificationInput[],
) {
  if (inputs.length === 0) return 0
  const result = await prisma.notification.createMany({
    data: inputs,
    skipDuplicates: true,
  })
  return result.count
}

/** Usuários (entre os passados) que JÁ têm EVENT_NEARBY deste evento. */
export async function findExistingNearbyUserIds(
  userIds: string[],
  eventId: string,
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set()
  const rows = await prisma.notification.findMany({
    where: { userId: { in: userIds }, type: 'EVENT_NEARBY', eventId },
    select: { userId: true },
  })
  return new Set(rows.map((r) => r.userId))
}

/** Linhas completas das notificações de um evento para os usuários dados (foreground). */
export async function findNotificationsForEvent(
  userIds: string[],
  eventId: string,
  type: NotificationType,
) {
  if (userIds.length === 0) return []
  return prisma.notification.findMany({
    where: { userId: { in: userIds }, eventId, type },
  })
}

/** Resumo do autor para montar a copy + payload da notificação (sem refetch no cliente). */
export async function findActorSummary(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      lastname: true,
      username: true,
      avatarUrl: true,
    },
  })
}

/**
 * Limpa as notificações de um relacionamento de follow quando ele é desfeito
 * (unfollow / rejeição / remoção de seguidor). Remove a notificação que virou
 * obsoleta E libera o dedupeKey, de modo que um refollow volte a notificar.
 * Cobre os dois sentidos: a notificação ao seguido (NEW_FOLLOWER/FOLLOW_REQUEST)
 * e a de aceite ao seguidor (FOLLOW_ACCEPTED).
 */
export async function deleteFollowNotifications(
  followerId: string,
  followingId: string,
) {
  const result = await prisma.notification.deleteMany({
    where: {
      OR: [
        {
          userId: followingId,
          actorId: followerId,
          type: { in: ['NEW_FOLLOWER', 'FOLLOW_REQUEST'] },
        },
        {
          userId: followerId,
          actorId: followingId,
          type: 'FOLLOW_ACCEPTED',
        },
      ],
    },
  })
  return result.count
}

/** Expurgo de retenção (LGPD): remove notificações criadas antes do corte. */
export async function deleteNotificationsOlderThan(cutoff: Date) {
  const result = await prisma.notification.deleteMany({
    where: { createdAt: { lt: cutoff } },
  })
  return result.count
}
