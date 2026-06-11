import type { Notification, NotificationType } from '@prisma/client'

/** Formato da notificação entregue ao cliente (sem userId/dedupeKey internos). */
export function shapeNotification(n: Notification) {
  return {
    id: n.id,
    type: n.type,
    actorId: n.actorId,
    eventId: n.eventId,
    postId: n.postId,
    commentId: n.commentId,
    spotId: n.spotId,
    title: n.title,
    body: n.body,
    data: n.data,
    readAt: n.readAt,
    createdAt: n.createdAt,
  }
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
