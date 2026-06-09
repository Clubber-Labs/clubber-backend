import type { FastifyInstance } from 'fastify'
import { checkDatabase, checkRedis, isHealthy } from './health.checks'

export async function healthRoutes(app: FastifyInstance) {
  // Healthcheck agregado (mantido por compatibilidade).
  app.get('/health', async (_request, reply) => {
    const [database, cache] = await Promise.all([checkDatabase(), checkRedis()])
    const ok = isHealthy(database, cache)
    return reply.status(ok ? 200 : 503).send({
      status: ok ? 'ok' : 'degraded',
      dependencies: { database, cache },
    })
  })

  // Liveness: o processo está de pé. NÃO checa dependências de propósito —
  // um banco fora não deve derrubar/reiniciar o processo (papel do readiness).
  app.get('/health/live', async (_request, reply) => {
    return reply.status(200).send({ status: 'ok' })
  })

  // Readiness: o processo consegue atender tráfego (dependências prontas).
  app.get('/health/ready', async (_request, reply) => {
    const [database, cache] = await Promise.all([checkDatabase(), checkRedis()])
    const ready = isHealthy(database, cache)
    return reply.status(ready ? 200 : 503).send({
      status: ready ? 'ready' : 'not-ready',
      dependencies: { database, cache },
    })
  })
}
