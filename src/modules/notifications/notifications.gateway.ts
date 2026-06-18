import type { WebSocket } from '@fastify/websocket'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import {
  NOTIFICATIONS_CHANNEL,
  type NotificationRealtimeEvent,
} from '../../lib/realtime'
import { redis } from '../../lib/redis'
import { createSocketRegistry, isTokenExpired } from '../chat/chat.hub'

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

      registry.add(userId, socket)
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

      const tokenCheck = setInterval(() => {
        if (isTokenExpired(claims, Math.floor(Date.now() / 1000))) {
          log.info({ userId }, 'token expirado; fechando socket')
          socket.close(4401, 'token expired')
        }
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
