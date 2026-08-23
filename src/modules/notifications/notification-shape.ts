import type { Notification, NotificationType } from '@prisma/client'
import type { Locale } from '../../lib/i18n/locale'
import {
  type NotificationActor,
  renderNotificationContent,
} from './notification-content'

/**
 * Formato entregue ao cliente (sem userId/dedupeKey internos), a partir de um
 * conteúdo já renderizado — o fan-out reaproveita a mesma renderização entre
 * destinatários do mesmo idioma sem que o id/createdAt de um vaze para o outro.
 */
export function shapeNotificationWith(
  n: Notification,
  content: { title: string; body: string },
) {
  return {
    id: n.id,
    type: n.type,
    actorId: n.actorId,
    eventId: n.eventId,
    postId: n.postId,
    commentId: n.commentId,
    spotId: n.spotId,
    title: content.title,
    body: content.body,
    data: n.data,
    readAt: n.readAt,
    createdAt: n.createdAt,
  }
}

/**
 * Continua saindo com title/body prontos — o que mudou foi a origem:
 * renderizados agora, no idioma do leitor, em vez de lidos de colunas
 * materializadas em PT.
 */
export function shapeNotification(
  n: Notification,
  actor: NotificationActor | null,
  locale: Locale,
) {
  return shapeNotificationWith(n, renderNotificationContent(n, actor, locale))
}

/**
 * `data` do push (payload do tap): o `data` persistido da notificação (actor,
 * etc.) + notificationId/type/ids de alvo não-nulos. Sem eles o app não roteia
 * o deep-link pro destino exato nem marca a notificação como lida. Só ids/tipo
 * — o payload do Expo tem teto de ~4KB.
 */
export function buildPushData(n: Notification): Record<string, unknown> {
  const base =
    n.data && typeof n.data === 'object' && !Array.isArray(n.data)
      ? (n.data as Record<string, unknown>)
      : {}
  return {
    ...base,
    notificationId: n.id,
    type: n.type,
    ...(n.actorId && { actorId: n.actorId }),
    ...(n.eventId && { eventId: n.eventId }),
    ...(n.postId && { postId: n.postId }),
    ...(n.commentId && { commentId: n.commentId }),
    ...(n.spotId && { spotId: n.spotId }),
  }
}

/**
 * Chave de dedupe determinística por (tipo + alvos). Dois gatilhos idênticos
 * (retry, duplo clique) colapsam na mesma notificação; gatilhos distintos geram
 * chaves diferentes. Módulo puro para não acoplar o fan-out ao service (evita
 * ciclo de import notifications.service ↔ notification-queue ↔ proximity-fanout).
 */
export function notificationDedupeKey(parts: {
  type: NotificationType
  actorId?: string | null
  eventId?: string | null
  postId?: string | null
  commentId?: string | null
  spotId?: string | null
}): string {
  return [
    parts.type,
    parts.actorId ?? '',
    parts.eventId ?? '',
    parts.postId ?? '',
    parts.commentId ?? '',
    parts.spotId ?? '',
  ].join(':')
}
