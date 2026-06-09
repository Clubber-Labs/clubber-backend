import fastifyWebsocket, { type WebSocket } from '@fastify/websocket'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { CHAT_CHANNEL, type RealtimeEvent, realtime } from '../../lib/realtime'
import { redis } from '../../lib/redis'
import {
  createSocketRegistry,
  dispatchEvent,
  isTokenExpired,
  localDeliveryRecipients,
} from './chat.hub'
import {
  findActiveParticipantUserIds,
  findConversationPartnerIds,
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
  await app.register(fastifyWebsocket)

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
    // Valida participação antes de propagar (evita spoof p/ conversa alheia).
    const participantIds = await findActiveParticipantUserIds(
      msg.conversationId,
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
    (socket: WebSocket, request: FastifyRequest) => {
      const token = (request.query as { token?: string }).token ?? ''
      let claims: { sub: string; exp?: number }
      try {
        claims = app.jwt.verify<{ sub: string; exp?: number }>(token)
      } catch {
        socket.close(4401, 'unauthorized')
        return
      }
      const userId = claims.sub

      const cameOnline = registry.add(userId, socket)
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

      // Revalida o JWT: fecha a sessão quando o token expira.
      const tokenCheck = setInterval(() => {
        if (isTokenExpired(claims, Math.floor(Date.now() / 1000))) {
          log.info({ userId }, 'token expirado; fechando socket')
          socket.close(4401, 'token expired')
        }
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
