import type { WebSocket } from '@fastify/websocket'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { isBlocked } from '../../lib/moderation-denylist'
import {
  NOTIFICATIONS_CHANNEL,
  type NotificationRealtimeEvent,
} from '../../lib/realtime'
import { redis } from '../../lib/redis'
import { authenticateWsToken } from '../../lib/ws-auth'
import { createSocketRegistry, sessionCloseReason } from '../chat/chat.hub'

const HEARTBEAT_MS = 30_000
const TOKEN_RECHECK_MS = 60_000

/** Frame entregue ao cliente para uma notificação ao vivo. */
export function notificationFrame(notification: unknown): string {
  return JSON.stringify({ type: 'notification', notification })
}

/**
 * Camada FINA de entrega ao vivo (foreground) de notificações. A persistência
 * in-app é a fonte da verdade (feita no service); aqui só repassamos o evento já
 * publicado no Redis aos sockets locais do destinatário. Espelha chat.gateway.
 *
 * NÃO registra @fastify/websocket aqui: ele é registrado uma única vez no
 * server.ts (raiz). Registrar dentro de cada gateway adicionava um 2º listener
 * de 'upgrade' no http.Server compartilhado (a dedup do fastify-plugin não cruza
 * escopos encapsulados irmãos), causando ERR_HTTP_SOCKET_ASSIGNED a cada conexão.
 */
export async function notificationsGateway(app: FastifyInstance) {
  const log = app.log.child({ module: 'notifications-ws' })
  const registry = createSocketRegistry()

  if (redis) {
    const subscriber = redis.duplicate()
    subscriber.subscribe(NOTIFICATIONS_CHANNEL).catch((err) => {
      log.error({ err }, 'falha ao assinar canal de notificações')
    })
    subscriber.on('message', (_channel, raw) => {
      try {
        const event = JSON.parse(raw) as NotificationRealtimeEvent
        registry.deliver(
          [event.recipientId],
          notificationFrame(event.notification),
        )
      } catch (err) {
        log.error({ err }, 'falha ao entregar notificação ao vivo')
      }
    })
    app.addHook('onClose', async () => {
      await subscriber.quit()
    })
    log.info('subscriber de notificações ativo')
  }

  app.get(
    '/ws/notifications',
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

      const { accepted } = registry.add(userId, socket)
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
      log.info({ userId, sockets: registry.onlineCount() }, 'socket conectado')

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

      const cleanup = () => {
        clearInterval(heartbeat)
        clearInterval(tokenCheck)
        registry.remove(userId, socket)
        log.info({ userId }, 'socket desconectado')
      }
      socket.on('close', cleanup)
      socket.on('error', cleanup)
    },
  )
}
