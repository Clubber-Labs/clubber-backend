import { Redis } from 'ioredis'
import { env } from './env'

export const redis = env.REDIS_URL
  ? new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 })
  : null

if (redis) {
  redis.on('error', (err) => {
    console.warn(`[redis] ${err.message}`)
  })
}
