import { timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import { env } from '../lib/env'
import {
  httpRequestDuration,
  httpRequestsInFlight,
  httpRequestsTotal,
  registry,
} from '../lib/metrics'

const METRICS_ROUTE = '/metrics'

// Usa o PADRÃO de rota (/events/:id), não a URL crua (/events/123), para evitar
// explosão de cardinalidade nas labels. Requests sem rota casada (404) viram
// 'unknown' para não criar uma label por URL inexistente.
function routeLabel(request: FastifyRequest): string {
  return request.routeOptions?.url ?? 'unknown'
}

function isMetricsRoute(request: FastifyRequest): boolean {
  return request.routeOptions?.url === METRICS_ROUTE
}

// Compara o header com `Bearer <token>` em tempo constante (evita timing attack).
// Exportada para teste unitário (é pura — não depende do env).
export function isAuthorized(
  authorization: string | undefined,
  token: string,
): boolean {
  if (!authorization) return false
  const provided = Buffer.from(authorization)
  const expected = Buffer.from(`Bearer ${token}`)
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  )
}

async function metricsPluginFn(app: FastifyInstance) {
  // Permite desligar a coleta/exposição inteira (ex.: ambiente onde /metrics não
  // deve subir). Sem isso ligado, nenhum hook nem a rota são registrados.
  if (!env.METRICS_ENABLED) return

  app.addHook('onRequest', async (request) => {
    if (isMetricsRoute(request)) return
    httpRequestsInFlight.inc({ method: request.method })
  })

  app.addHook('onResponse', async (request, reply) => {
    if (isMetricsRoute(request)) return
    httpRequestsInFlight.dec({ method: request.method })
    const labels = {
      method: request.method,
      route: routeLabel(request),
      status_code: reply.statusCode,
    }
    httpRequestsTotal.inc(labels)
    // reply.elapsedTime é em milissegundos → converte para segundos.
    httpRequestDuration.observe(labels, reply.elapsedTime / 1000)
  })

  // /metrics exige Bearer auth quando METRICS_TOKEN está definido. Em produção o
  // token é OBRIGATÓRIO (validado no env: refine METRICS_TOKEN+prod), então o
  // caminho "aberto" abaixo só ocorre em dev/test.
  const metricsHandler = async (
    _request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    reply.header('Content-Type', registry.contentType)
    return registry.metrics()
  }

  const token = env.METRICS_TOKEN
  if (token) {
    // `if (token)` estreita o tipo para string — sem cast. Auth obrigatória.
    const requireAuth = async (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => {
      if (!isAuthorized(request.headers.authorization, token)) {
        return reply.status(401).send({ message: 'Unauthorized' })
      }
    }
    app.get(METRICS_ROUTE, { onRequest: requireAuth }, metricsHandler)
  } else {
    // Sem token só ocorre em dev/test (o env garante o token em prod).
    app.get(METRICS_ROUTE, metricsHandler)
  }
}

// fp() expõe os hooks no escopo raiz da app (sem encapsulamento), aplicando-os
// a todas as rotas registradas depois do plugin.
export const metricsPlugin = fp(metricsPluginFn, { name: 'metrics-plugin' })
