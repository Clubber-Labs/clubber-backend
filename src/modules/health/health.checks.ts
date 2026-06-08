import { prisma } from '../../lib/prisma'
import { redis } from '../../lib/redis'

export type DependencyStatus = 'up' | 'down' | 'disabled'

export async function checkDatabase(): Promise<DependencyStatus> {
  try {
    await prisma.$queryRaw`SELECT 1`
    return 'up'
  } catch {
    return 'down'
  }
}

export async function checkRedis(): Promise<DependencyStatus> {
  if (!redis) return 'disabled'
  try {
    const pong = await redis.ping()
    return pong === 'PONG' ? 'up' : 'down'
  } catch {
    return 'down'
  }
}
