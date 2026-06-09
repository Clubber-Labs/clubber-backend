import { logger } from './logger'
import { redis } from './redis'

export const CHAT_CHANNEL = 'chat:events'
export const NOTIFICATIONS_CHANNEL = 'notifications:events'

/**
 * Evento de notificação publicado no Redis para entrega ao vivo (foreground) via
 * WebSocket. `recipientId` é o único destinatário; o gateway entrega o frame só
 * aos sockets locais dele. Modelo publish-and-let-gateway-decide: o produtor
 * sempre publica, cada instância entrega a quem tem socket local.
 */
export type NotificationRealtimeEvent = {
  type: 'notification'
  recipientId: string
  notification: unknown
}

/**
 * Eventos de chat publicados no Redis para entrega ao vivo via WebSocket.
 * Discriminados por `type`; o gateway traduz cada um no frame entregue ao
 * cliente. `participantIds` viaja junto pra que o subscriber não precise
 * consultar o banco no caminho de entrega.
 */
export type RealtimeEvent =
  | {
      type: 'message'
      conversationId: string
      participantIds: string[]
      // `senderId`/`createdAt` viajam fora de `message` (opaco) pra o gateway
      // marcar entrega server-side sem desserializar o payload.
      senderId: string
      createdAt: string
      message: unknown
    }
  | {
      type: 'message_edited'
      conversationId: string
      participantIds: string[]
      message: unknown
    }
  | {
      type: 'typing'
      conversationId: string
      participantIds: string[]
      userId: string
      isTyping: boolean
    }
  | {
      type: 'presence'
      participantIds: string[]
      userId: string
      online: boolean
      lastSeenAt: string | null
    }
  // Recibos: `userId` é quem recebeu/leu; `at` é o watermark (ISO 8601). O
  // gateway entrega o frame aos OUTROS participantes, nunca ao próprio autor.
  | {
      type: 'delivered'
      conversationId: string
      participantIds: string[]
      userId: string
      at: string
    }
  | {
      type: 'read'
      conversationId: string
      participantIds: string[]
      userId: string
      at: string
    }

/**
 * Publica eventos de chat para entrega ao vivo via WebSocket. Tolerante a
 * falha (igual ao cache): nunca propaga erro nem quebra o fluxo REST se o
 * Redis estiver ausente/indisponível — a persistência da mensagem é a
 * fonte da verdade; a entrega ao vivo é best-effort.
 */
export const realtime = {
  async publish(event: RealtimeEvent): Promise<void> {
    if (!redis) return
    try {
      await redis.publish(CHAT_CHANNEL, JSON.stringify(event))
    } catch (err) {
      // Best-effort: entrega ao vivo falhou, mas a mensagem já foi persistida.
      logger.warn({ err, type: event.type }, 'realtime publish falhou')
    }
  },

  /**
   * Publica uma notificação para entrega ao vivo (foreground). Best-effort,
   * igual ao publish do chat: a notificação já foi persistida (in-app é a fonte
   * da verdade); a entrega ao vivo é cereja do bolo.
   */
  async publishNotification(event: NotificationRealtimeEvent): Promise<void> {
    if (!redis) return
    try {
      await redis.publish(NOTIFICATIONS_CHANNEL, JSON.stringify(event))
    } catch (err) {
      logger.warn(
        { err, recipientId: event.recipientId },
        'realtime publishNotification falhou',
      )
    }
  },
}
