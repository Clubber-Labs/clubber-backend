import type { Notification, NotificationType, Prisma } from '@prisma/client'
import { Expo } from 'expo-server-sdk'
import { env } from '../../lib/env'
import { logger } from '../../lib/logger'
import { realtime } from '../../lib/realtime'
import { isBlockedEitherWay } from '../blocks/blocks.repository'
import {
  deleteDeviceToken,
  registerDeviceToken,
} from './device-token.repository'
import {
  countUnreadNotifications,
  createNotificationIfNew,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationCursor,
  notificationExists,
} from './notification.repository'
import type { ListNotificationsQuery } from './notifications.schema'

export type SocialNotificationInput = {
  recipientId: string
  /** Quem causou a notificação. Ausente em eventos não-sociais (ex.: sistema). */
  actorId?: string | null
  type: NotificationType
  title: string
  body: string
  eventId?: string | null
  postId?: string | null
  commentId?: string | null
  data?: Prisma.InputJsonValue
}

/**
 * Chave de dedupe determinística por (tipo + alvos). Dois gatilhos idênticos
 * (retry, duplo clique) colapsam na mesma notificação; gatilhos distintos (outro
 * comentário, outro evento) geram chaves diferentes.
 */
function buildDedupeKey(input: SocialNotificationInput): string {
  return [
    input.type,
    input.actorId ?? '',
    input.eventId ?? '',
    input.postId ?? '',
    input.commentId ?? '',
  ].join(':')
}

/** Formato da notificação entregue ao cliente (sem userId/dedupeKey internos). */
export function shapeNotification(n: Notification) {
  return {
    id: n.id,
    type: n.type,
    actorId: n.actorId,
    eventId: n.eventId,
    postId: n.postId,
    commentId: n.commentId,
    title: n.title,
    body: n.body,
    data: n.data,
    readAt: n.readAt,
    createdAt: n.createdAt,
  }
}

/**
 * Despacha uma notificação social: cria a in-app (idempotente) e entrega em
 * foreground (best-effort). NUNCA propaga erro — é chamado de dentro dos fluxos
 * REST (entrega 3) e não pode quebrar a ação principal. O envio de push é da
 * entrega 5; aqui paramos no in-app + realtime.
 *
 * Guardas: não notifica a si mesmo (autor == destinatário) nem quando há
 * bloqueio entre as partes (reusa isBlockedEitherWay do módulo blocks).
 */
export async function dispatchSocial(
  input: SocialNotificationInput,
): Promise<void> {
  // Master switch: feature desligada → nenhum despacho (in-app/foreground/push).
  // Ponto único de controle — os gatilhos da entrega 3 não precisam checar o flag.
  if (!env.NOTIFICATIONS_ENABLED) return
  try {
    const { recipientId, actorId } = input
    if (actorId && actorId === recipientId) return
    if (actorId && (await isBlockedEitherWay(actorId, recipientId))) return

    const notification = await createNotificationIfNew({
      userId: recipientId,
      type: input.type,
      actorId: input.actorId ?? null,
      eventId: input.eventId ?? null,
      postId: input.postId ?? null,
      commentId: input.commentId ?? null,
      title: input.title,
      body: input.body,
      data: input.data,
      dedupeKey: buildDedupeKey(input),
    })
    // Duplicada (mesmo dedupeKey): pula o foreground — idempotência completa.
    if (!notification) return

    await realtime.publishNotification({
      type: 'notification',
      recipientId,
      notification: shapeNotification(notification),
    })
  } catch (err) {
    logger.warn(
      { err, type: input.type, recipientId: input.recipientId },
      'dispatch de notificação falhou',
    )
  }
}

function encodeCursor(cursor: NotificationCursor): string {
  return Buffer.from(
    JSON.stringify({
      createdAt: cursor.createdAt.toISOString(),
      id: cursor.id,
    }),
  ).toString('base64url')
}

function decodeCursor(raw: string): NotificationCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (
      typeof parsed?.id === 'string' &&
      typeof parsed?.createdAt === 'string'
    ) {
      const createdAt = new Date(parsed.createdAt)
      if (!Number.isNaN(createdAt.getTime()))
        return { createdAt, id: parsed.id }
    }
    return null
  } catch {
    return null
  }
}

export async function getNotifications(
  userId: string,
  query: ListNotificationsQuery,
) {
  const decoded = query.cursor ? decodeCursor(query.cursor) : undefined
  if (query.cursor && !decoded) {
    throw { statusCode: 400, message: 'Cursor inválido' }
  }
  const rows = await listNotifications(
    userId,
    query.limit,
    decoded ?? undefined,
  )
  const last = rows[rows.length - 1]
  const nextCursor =
    rows.length === query.limit && last
      ? encodeCursor({ createdAt: last.createdAt, id: last.id })
      : null
  return { data: rows.map(shapeNotification), nextCursor }
}

export async function markRead(userId: string, id: string) {
  const updated = await markNotificationRead(userId, id)
  if (updated > 0) return
  // Não atualizou: já lida (idempotente, ok) ou não existe/é de outro (404).
  if (!(await notificationExists(userId, id))) {
    throw { statusCode: 404, message: 'Notificação não encontrada' }
  }
}

export async function markAllRead(userId: string) {
  return markAllNotificationsRead(userId)
}

export async function getUnreadCount(userId: string) {
  return countUnreadNotifications(userId)
}

export async function registerDevice(
  userId: string,
  token: string,
  platform?: string,
) {
  if (!Expo.isExpoPushToken(token)) {
    throw { statusCode: 400, message: 'Token de push inválido' }
  }
  return registerDeviceToken(userId, token, platform)
}

export async function removeDevice(userId: string, token: string) {
  // Idempotente por design: remover um token já ausente (ou de outro dono) é 204,
  // não 404 — o objetivo do cliente é só garantir que o device pare de receber
  // push. deleteDeviceToken filtra por (token, userId), então nunca apaga de
  // terceiros (sem IDOR).
  await deleteDeviceToken(userId, token)
}
