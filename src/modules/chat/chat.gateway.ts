import type { WebSocket } from '@fastify/websocket'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { isBlocked } from '../../lib/moderation-denylist'
import { CHAT_CHANNEL, type RealtimeEvent, realtime } from '../../lib/realtime'
import { redis } from '../../lib/redis'
import { authenticateWsToken } from '../../lib/ws-auth'
import {
  createSocketRegistry,
  dispatchEvent,
  localDeliveryRecipients,
  sessionCloseReason,
} from './chat.hub'
import {
  findConversationPartnerIds,
  findTypingRecipientUserIds,
  markDeliveredIfBehind,
  touchLastSeen,
} from './chat.repository'

// Intervalos de manutenção da conexão.
const HEARTBEAT_MS = 30_000
const TOKEN_RECHECK_MS = 60_000

/**
 * Camada FINA de entrega ao vivo. Toda a regra de negócio (persistência,
 * autorização) vive no REST/service; aqui repassamos eventos já publicados no
 * Redis para os sockets locais dos participantes e recebemos sinais efêmeros
 * (digitando). A lógica pura (registro de sockets, frames, expiração) está em
 * chat.hub.ts e é coberta por testes; este arquivo é o glue de I/O, verificado
 * manualmente.
 *
 * Hardening: heartbeat ping/pong derruba conexões zumbis; o token é revalidado
 * periodicamente (JWT expira no meio de uma sessão longa); timers e sockets são
 * sempre limpos no close/error.
 */
export async function chatGateway(app: FastifyInstance) {
  // @fastify/websocket é registrado uma única vez no server.ts (raiz) — ver a
  // nota lá sobre o ERR_HTTP_SOCKET_ASSIGNED. Aqui só herdamos o suporte.
  const log = app.log.child({ module: 'chat-ws' })
  const registry = createSocketRegistry()

  if (redis) {
    const subscriber = redis.duplicate()
    subscriber.subscribe(CHAT_CHANNEL).catch((err) => {
      log.error({ err }, 'falha ao assinar canal de chat')
    })
    subscriber.on('message', (_channel, raw) => {
      try {
        const event = JSON.parse(raw) as RealtimeEvent
        dispatchEvent(registry, event)
        void markLocalDeliveries(event)
      } catch (err) {
        log.error({ err }, 'falha ao entregar evento de chat')
      }
    })
    app.addHook('onClose', async () => {
      await subscriber.quit()
    })
    log.info('subscriber de chat ativo')
  }

  /**
   * Marca entrega server-side: ao receber uma `message`, avança o
   * lastDeliveredAt dos destinatários conectados neste processo e emite
   * `delivered` ao remetente — sem depender do ack do app. Best-effort: erro
   * aqui nunca derruba a entrega da mensagem. O guard `markDeliveredIfBehind`
   * mantém o watermark monotônico e evita frame duplicado/atrasado.
   */
  async function markLocalDeliveries(event: RealtimeEvent) {
    if (event.type !== 'message') return
    const upTo = new Date(event.createdAt)
    // Em paralelo: cada destinatário é uma linha/publish independente, sem
    // contenção. O try/catch por destinatário isola a falha (não derruba os
    // outros) e preserva o log com o userId.
    await Promise.allSettled(
      localDeliveryRecipients(registry, event).map(async (userId) => {
        try {
          const at = await markDeliveredIfBehind(
            event.conversationId,
            userId,
            upTo,
          )
          if (!at) return
          await realtime.publish({
            type: 'delivered',
            conversationId: event.conversationId,
            participantIds: event.participantIds,
            userId,
            at: at.toISOString(),
          })
        } catch (err) {
          log.error({ err, userId }, 'falha ao marcar entrega server-side')
        }
      }),
    )
  }

  /** Anuncia presença (online/offline) aos parceiros de conversa do usuário. */
  async function announcePresence(userId: string, online: boolean) {
    try {
      let lastSeenAt: string | null = null
      if (!online) {
        const seenAt = await touchLastSeen(userId)
        lastSeenAt = seenAt.toISOString()
      }
      const participantIds = await findConversationPartnerIds(userId)
      if (participantIds.length === 0) return
      await realtime.publish({
        type: 'presence',
        participantIds,
        userId,
        online,
        lastSeenAt,
      })
    } catch (err) {
      log.error({ err, userId, online }, 'falha ao anunciar presença')
    }
  }

  /** Sinais efêmeros vindos do cliente (apenas "digitando" no v1). */
  async function handleInbound(userId: string, raw: string) {
    let msg: { type?: string; conversationId?: string; isTyping?: boolean }
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (msg.type !== 'typing' || typeof msg.conversationId !== 'string') return
    // Destinatários do typing já SEM quem bloqueou o remetente (ou foi bloqueado
    // por ele) — typing não atravessa bloqueio, igual à presença. O remetente
    // segue na lista (não há auto-bloqueio), então o includes abaixo continua
    // validando participação e barra spoof p/ conversa alheia.
    const participantIds = await findTypingRecipientUserIds(
      msg.conversationId,
      userId,
    )
    if (!participantIds.includes(userId)) return
    await realtime.publish({
      type: 'typing',
      conversationId: msg.conversationId,
      participantIds,
      userId,
      isTyping: msg.isTyping === true,
    })
  }

  app.get(
    '/ws/chat',
    { websocket: true },
    async (socket: WebSocket, request: FastifyRequest) => {
      const token = (request.query as { token?: string }).token ?? ''
      const claims = await authenticateWsToken(app, token)
      if (!claims) {
        // Token inválido, de matrícula MFA, ou conta banida/suspensa (denylist).
        socket.close(4401, 'unauthorized')
        return
      }
      const userId = claims.sub

      const { accepted, cameOnline } = registry.add(userId, socket)
      if (!accepted) {
        // Teto por usuário atingido: recusa ANTES de alocar timers/handlers,
        // pra a conexão rejeitada não vazar heartbeat/tokenCheck.
        log.warn(
          { userId, sockets: registry.onlineCount() },
          'limite de conexões WS por usuário atingido; recusando',
        )
        socket.close(4429, 'too many connections')
        return
      }
      if (cameOnline) void announcePresence(userId, true)
      log.info(
        { userId, online: cameOnline, sockets: registry.onlineCount() },
        'socket conectado',
      )

      // Heartbeat: ping periódico; encerra sockets que pararam de responder.
      let alive = true
      socket.on('pong', () => {
        alive = true
      })
      const heartbeat = setInterval(() => {
        if (!alive) {
          log.warn({ userId }, 'socket sem pong; encerrando')
          socket.terminate()
          return
        }
        alive = false
        try {
          socket.ping()
        } catch {
          socket.terminate()
        }
      }, HEARTBEAT_MS)

      // Revalida a sessão periodicamente (o WS é persistente; espelha o REST que
      // checa a cada request): fecha quando o JWT expira OU quando a conta entra
      // na denylist de moderação DEPOIS do handshake (ban/suspensão em sessão).
      const tokenCheck = setInterval(() => {
        void (async () => {
          const reason = await sessionCloseReason(
            claims,
            Math.floor(Date.now() / 1000),
            () => isBlocked(userId),
          )
          if (reason) {
            log.info({ userId, reason }, 'encerrando socket na revalidação')
            socket.close(4401, reason)
          }
        })()
      }, TOKEN_RECHECK_MS)

      socket.on('message', (raw: Buffer) => {
        void handleInbound(userId, raw.toString())
      })

      const cleanup = () => {
        clearInterval(heartbeat)
        clearInterval(tokenCheck)
        const wentOffline = registry.remove(userId, socket)
        if (wentOffline) void announcePresence(userId, false)
        log.info({ userId, offline: wentOffline }, 'socket desconectado')
      }
      socket.on('close', cleanup)
      socket.on('error', cleanup)
    },
  )
}
