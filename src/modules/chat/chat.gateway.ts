import fastifyWebsocket, { type WebSocket } from '@fastify/websocket'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { CHAT_CHANNEL, type RealtimePayload } from '../../lib/realtime'
import { redis } from '../../lib/redis'

const WS_OPEN = 1

/**
 * Camada FINA de entrega ao vivo. Toda a regra de negócio (persistência,
 * autorização) está no REST/service; aqui só repassamos as mensagens já
 * publicadas no Redis para os sockets locais dos participantes.
 *
 * Multi-instância: o mapa userId→sockets é por processo; o pub/sub do Redis
 * (cliente dedicado via duplicate()) garante que cada instância entregue aos
 * seus sockets. Não é coberto pela suíte Vitest (verificação manual).
 */
export async function chatGateway(app: FastifyInstance) {
  await app.register(fastifyWebsocket)

  const sockets = new Map<string, Set<WebSocket>>()

  function addSocket(userId: string, socket: WebSocket) {
    const set = sockets.get(userId) ?? new Set<WebSocket>()
    set.add(socket)
    sockets.set(userId, set)
  }

  function removeSocket(userId: string, socket: WebSocket) {
    const set = sockets.get(userId)
    if (!set) return
    set.delete(socket)
    if (set.size === 0) sockets.delete(userId)
  }

  if (redis) {
    const subscriber = redis.duplicate()
    subscriber.subscribe(CHAT_CHANNEL).catch((err) => {
      app.log.error({ err }, 'falha ao assinar canal de chat')
    })
    subscriber.on('message', (_channel, raw) => {
      try {
        const payload = JSON.parse(raw) as RealtimePayload
        const frame = JSON.stringify({
          type: 'message',
          conversationId: payload.conversationId,
          message: payload.message,
        })
        for (const userId of payload.participantIds) {
          const set = sockets.get(userId)
          if (!set) continue
          for (const socket of set) {
            if (socket.readyState === WS_OPEN) socket.send(frame)
          }
        }
      } catch (err) {
        app.log.error({ err }, 'falha ao entregar mensagem de chat')
      }
    })
    app.addHook('onClose', async () => {
      await subscriber.quit()
    })
  }

  app.get(
    '/ws/chat',
    { websocket: true },
    (socket: WebSocket, request: FastifyRequest) => {
      const token = (request.query as { token?: string }).token
      let userId: string
      try {
        const payload = app.jwt.verify<{ sub: string }>(token ?? '')
        userId = payload.sub
      } catch {
        socket.close(4401, 'unauthorized')
        return
      }

      addSocket(userId, socket)
      socket.on('close', () => removeSocket(userId, socket))
      socket.on('error', () => removeSocket(userId, socket))
    },
  )
}
