import { redis } from './redis'

export const CHAT_CHANNEL = 'chat:events'

export type RealtimePayload = {
  conversationId: string
  participantIds: string[]
  message: unknown
}

/**
 * Publica eventos de chat para entrega ao vivo via WebSocket. Tolerante a
 * falha (igual ao cache): nunca propaga erro nem quebra o fluxo REST se o
 * Redis estiver ausente/indisponível — a persistência da mensagem é a
 * fonte da verdade; a entrega ao vivo é best-effort.
 */
export const realtime = {
  async publish(payload: RealtimePayload): Promise<void> {
    if (!redis) return
    try {
      await redis.publish(CHAT_CHANNEL, JSON.stringify(payload))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[realtime] publish falhou: ${message}`)
    }
  },
}
