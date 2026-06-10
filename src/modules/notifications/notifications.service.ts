import type { NotificationType, Prisma } from '@prisma/client'
import { Expo } from 'expo-server-sdk'
import { env } from '../../lib/env'
import { logger } from '../../lib/logger'
import { realtime } from '../../lib/realtime'
import { isBlockedEitherWay } from '../blocks/blocks.repository'
import { hasConsent } from '../consent/consent.service'
import {
  updateNotifyRadius,
  updateUserLocation,
} from '../users/users.repository'
import {
  deleteDeviceToken,
  registerDeviceToken,
} from './device-token.repository'
import {
  countUnreadNotifications,
  createNotificationIfNew,
  deleteFollowNotifications,
  findActorSummary,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationCursor,
  notificationExists,
} from './notification.repository'
import {
  type SocialNotificationKind,
  socialNotificationContent,
} from './notification-content'
import { enqueuePush } from './notification-queue'
import {
  buildPushData,
  notificationDedupeKey,
  shapeNotification,
} from './notification-shape'
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

// dedupeKey de NEW_FOLLOWER/FOLLOW_REQUEST/FOLLOW_ACCEPTED é só (tipo, actor,
// recipient); refollow volta a notificar porque unfollow/rejeição/remoção
// chamam clearFollowNotifications, que libera a chave (ver follows.service).
function buildDedupeKey(input: SocialNotificationInput): string {
  return notificationDedupeKey(input)
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

    // Push (canal do SO): só com consentimento de push. Enfileirado — não bloqueia
    // a request; o worker envia via Expo (entrega 5). O data leva notificationId/
    // type/ids para o deep-link e o mark-as-read no tap (contrato do mobile).
    if (await hasConsent(recipientId, 'pushNotifications')) {
      await enqueuePush(recipientId, {
        title: notification.title,
        body: notification.body,
        data: buildPushData(notification),
      })
    }
  } catch (err) {
    logger.warn(
      { err, type: input.type, recipientId: input.recipientId },
      'dispatch de notificação falhou',
    )
  }
}

export type ActorNotificationInput = {
  recipientId: string
  actorId: string
  // Só tipos sociais (com autor); EVENT_NEARBY (proximidade) não passa por aqui.
  type: SocialNotificationKind
  eventId?: string | null
  postId?: string | null
  commentId?: string | null
}

/**
 * Atalho dos gatilhos sociais (entrega 3): resolve o autor, monta a copy e
 * delega ao dispatchSocial. Os serviços de origem (follow, comentário, reação,
 * presença, convite) só passam o tipo + ids — sem texto, sem boilerplate.
 * Best-effort: nunca quebra a ação principal. O self-guard adiantado evita o
 * fetch do autor quando autor == destinatário (caso comum: comentar no próprio
 * conteúdo). O block-guard fica no dispatchSocial.
 */
export async function notifyFromActor(
  input: ActorNotificationInput,
): Promise<void> {
  try {
    if (!env.NOTIFICATIONS_ENABLED) return
    if (input.actorId === input.recipientId) return

    const actor = await findActorSummary(input.actorId)
    if (!actor) return

    const { title, body } = socialNotificationContent(input.type, actor)
    await dispatchSocial({
      recipientId: input.recipientId,
      actorId: input.actorId,
      type: input.type,
      eventId: input.eventId,
      postId: input.postId,
      commentId: input.commentId,
      title,
      body,
      data: {
        actor: {
          id: actor.id,
          name: actor.name,
          lastname: actor.lastname,
          username: actor.username,
          avatarUrl: actor.avatarUrl,
        },
      },
    })
  } catch (err) {
    logger.warn(
      { err, type: input.type, recipientId: input.recipientId },
      'notifyFromActor falhou',
    )
  }
}

/**
 * Limpa as notificações de um follow desfeito (chamado pelos fluxos de
 * unfollow / rejeição / remoção). Best-effort: nunca quebra a ação principal.
 * Remove a notificação obsoleta e libera o dedupe para um refollow re-notificar.
 */
export async function clearFollowNotifications(
  followerId: string,
  followingId: string,
): Promise<void> {
  try {
    await deleteFollowNotifications(followerId, followingId)
  } catch (err) {
    logger.warn(
      { err, followerId, followingId },
      'clearFollowNotifications falhou',
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

/**
 * Grava a localização grosseira (geohash) do usuário. Gate de consentimento:
 * exige locationPrecise — sem ele, 403 e nada é persistido (a coordenada nunca
 * entra no banco). Reusa o hasConsent (que respeita revokedAt).
 */
export async function setUserLocation(userId: string, geohash: string) {
  if (!(await hasConsent(userId, 'locationPrecise'))) {
    throw {
      statusCode: 403,
      message: 'Consentimento de localização necessário',
    }
  }
  return updateUserLocation(userId, geohash)
}

export async function setNotifyRadius(userId: string, radiusKm: number) {
  // Invariante operacional: o raio do usuário (refino por linha) nunca pode
  // passar do pré-filtro ST_DWithin (raio MÁXIMO constante). Enforçado aqui — se
  // o teto baixar via env, raios acima dele param de ser aceitos (sem degradação
  // silenciosa onde o ST_DWithin cortaria antes do refino).
  if (radiusKm > env.NOTIFY_MAX_RADIUS_KM) {
    throw {
      statusCode: 400,
      message: `Raio máximo permitido: ${env.NOTIFY_MAX_RADIUS_KM}km`,
    }
  }
  return updateNotifyRadius(userId, radiusKm)
}
