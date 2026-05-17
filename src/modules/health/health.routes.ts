import type { FastifyInstance } from 'fastify'
import { prisma } from '../../lib/prisma'
import { redis } from '../../lib/redis'

type DependencyStatus = 'up' | 'down' | 'disabled'

async function checkDatabase(): Promise<DependencyStatus> {
  try {
    await prisma.$queryRaw`SELECT 1`
    return 'up'
  } catch {
    return 'down'
  }
}

async function checkRedis(): Promise<DependencyStatus> {
  if (!redis) return 'disabled'
  try {
    const pong = await redis.ping()
    return pong === 'PONG' ? 'up' : 'down'
  } catch {
    return 'down'
  }
}

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (_request, reply) => {
    const [database, cache] = await Promise.all([checkDatabase(), checkRedis()])
    const ok = database === 'up' && cache !== 'down'
    return reply.status(ok ? 200 : 503).send({
      status: ok ? 'ok' : 'degraded',
      dependencies: { database, cache },
    })
  })
}
