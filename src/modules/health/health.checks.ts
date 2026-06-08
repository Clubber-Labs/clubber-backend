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

/**
 * Decisão de saúde/prontidão (pura, para ser testável sem mocks): pronto quando
 * o banco está up e o cache não está down. `cache: 'disabled'` é aceitável —
 * o Redis é opcional e sua ausência não impede o serviço de atender.
 */
export function isHealthy(
  database: DependencyStatus,
  cache: DependencyStatus,
): boolean {
  return database === 'up' && cache !== 'down'
}
