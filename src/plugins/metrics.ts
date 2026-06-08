import type { FastifyInstance, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
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

async function metricsPluginFn(app: FastifyInstance) {
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

  app.get(METRICS_ROUTE, async (_request, reply) => {
    reply.header('Content-Type', registry.contentType)
    return registry.metrics()
  })
}

// fp() expõe os hooks no escopo raiz da app (sem encapsulamento), aplicando-os
// a todas as rotas registradas depois do plugin.
export const metricsPlugin = fp(metricsPluginFn, { name: 'metrics-plugin' })
