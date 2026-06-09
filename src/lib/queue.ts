import type { Processor } from 'bullmq'
import { Queue, type QueueOptions, Worker, type WorkerOptions } from 'bullmq'
import { Redis } from 'ioredis'
import { env } from './env'
import { logger } from './logger'

/**
 * Conexões dedicadas ao BullMQ. Os comandos bloqueantes do Worker
 * (BRPOPLPUSH/BZPOPMIN) exigem `maxRetriesPerRequest: null` — incompatível com
 * o singleton `redis` (que usa `3`, ver lib/redis.ts). Por isso NUNCA reusamos
 * aquele cliente aqui: cada Queue/Worker recebe sua própria conexão IORedis.
 */
export const bullConnectionOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
} as const

function createConnection(): Redis | null {
  if (!env.REDIS_URL) return null
  const connection = new Redis(env.REDIS_URL, bullConnectionOptions)
  connection.on('error', (err) => {
    logger.warn({ err: err.message }, '[queue] erro de conexão redis')
  })
  return connection
}

/**
 * Cria uma Queue do BullMQ com conexão dedicada. Retorna `null` quando não há
 * Redis configurado — o caller decide o fallback (notificação é best-effort).
 */
export function createQueue<T = unknown>(
  name: string,
  opts?: Omit<QueueOptions, 'connection'>,
): Queue<T> | null {
  const connection = createConnection()
  if (!connection) return null
  return new Queue<T>(name, { ...opts, connection })
}

/**
 * Cria um Worker do BullMQ com conexão dedicada. Retorna `null` quando não há
 * Redis configurado.
 */
export function createWorker<T = unknown>(
  name: string,
  processor: Processor<T>,
  opts?: Omit<WorkerOptions, 'connection'>,
): Worker<T> | null {
  const connection = createConnection()
  if (!connection) return null
  return new Worker<T>(name, processor, { ...opts, connection })
}
