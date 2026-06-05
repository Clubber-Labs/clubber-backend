import type { RealtimeEvent } from '../../lib/realtime'

/** readyState OPEN do protocolo WebSocket (igual em todas as libs). */
export const WS_OPEN = 1

/** Interface mínima de socket — facilita testar sem uma conexão real. */
export interface ClientSocket {
  readyState: number
  send(data: string): void
}

/**
 * Registro em memória de sockets por usuário (multi-aba), por processo.
 * Puro e sem I/O — o gateway pluga os sockets reais; os testes plugam fakes.
 * `add`/`remove` retornam se o usuário cruzou a fronteira online/offline,
 * pra o gateway disparar presença só na transição (não a cada aba).
 */
export function createSocketRegistry() {
  const byUser = new Map<string, Set<ClientSocket>>()

  return {
    /** Retorna true se o usuário estava offline e ficou online agora. */
    add(userId: string, socket: ClientSocket): boolean {
      const set = byUser.get(userId) ?? new Set<ClientSocket>()
      const wasOffline = set.size === 0
      set.add(socket)
      byUser.set(userId, set)
      return wasOffline
    },
    /** Retorna true se essa era a última aba e o usuário ficou offline. */
    remove(userId: string, socket: ClientSocket): boolean {
      const set = byUser.get(userId)
      if (!set) return false
      set.delete(socket)
      if (set.size === 0) {
        byUser.delete(userId)
        return true
      }
      return false
    },
    isOnline(userId: string): boolean {
      return (byUser.get(userId)?.size ?? 0) > 0
    },
    /** Entrega o frame aos sockets abertos dos usuários; retorna quantos. */
    deliver(userIds: Iterable<string>, frame: string): number {
      let sent = 0
      for (const userId of userIds) {
        const set = byUser.get(userId)
        if (!set) continue
        for (const socket of set) {
          if (socket.readyState === WS_OPEN) {
            socket.send(frame)
            sent++
          }
        }
      }
      return sent
    },
    /** Quantidade de usuários online (1+ aba). */
    onlineCount(): number {
      return byUser.size
    },
  }
}

export function messageFrame(
  type: 'message' | 'message_edited',
  conversationId: string,
  message: unknown,
): string {
  return JSON.stringify({ type, conversationId, message })
}

export function typingFrame(event: {
  conversationId: string
  userId: string
  isTyping: boolean
}): string {
  return JSON.stringify({
    type: 'typing',
    conversationId: event.conversationId,
    userId: event.userId,
    isTyping: event.isTyping,
  })
}

export function presenceFrame(event: {
  userId: string
  online: boolean
  lastSeenAt: string | null
}): string {
  return JSON.stringify({
    type: 'presence',
    userId: event.userId,
    online: event.online,
    lastSeenAt: event.lastSeenAt,
  })
}

/** Recibo de entrega/leitura: `userId` recebeu/leu tudo até `at` (ISO 8601). */
export function receiptFrame(
  type: 'delivered' | 'read',
  event: { conversationId: string; userId: string; at: string },
): string {
  return JSON.stringify({
    type,
    conversationId: event.conversationId,
    userId: event.userId,
    at: event.at,
  })
}

/**
 * Destinatários de uma mensagem que estão conectados NESTE processo (exceto o
 * remetente) — alvos da marcação de entrega server-side. O gateway só conhece
 * os sockets locais, então cada instância marca apenas quem ela atende.
 */
export function localDeliveryRecipients(
  registry: ReturnType<typeof createSocketRegistry>,
  event: { participantIds: string[]; senderId: string },
): string[] {
  return event.participantIds.filter(
    (id) => id !== event.senderId && registry.isOnline(id),
  )
}

/** JWT expirou? (claim `exp` em segundos; ausência = sem expiração). */
export function isTokenExpired(
  claims: { exp?: number },
  nowSeconds: number,
): boolean {
  return typeof claims.exp === 'number' && claims.exp <= nowSeconds
}

/**
 * Traduz um evento do Redis no(s) frame(s) entregue(s) aos sockets locais.
 * `typing`/`presence` nunca voltam pro próprio autor. Retorna o nº de envios.
 */
export function dispatchEvent(
  registry: ReturnType<typeof createSocketRegistry>,
  event: RealtimeEvent,
): number {
  switch (event.type) {
    case 'message':
    case 'message_edited':
      return registry.deliver(
        event.participantIds,
        messageFrame(event.type, event.conversationId, event.message),
      )
    case 'typing':
      return registry.deliver(
        event.participantIds.filter((id) => id !== event.userId),
        typingFrame(event),
      )
    case 'presence':
      return registry.deliver(
        event.participantIds.filter((id) => id !== event.userId),
        presenceFrame(event),
      )
    case 'delivered':
    case 'read':
      return registry.deliver(
        event.participantIds.filter((id) => id !== event.userId),
        receiptFrame(event.type, event),
      )
  }
}
