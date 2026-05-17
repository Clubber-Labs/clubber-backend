import { redis } from './redis'

const CACHE_VERSION = 'v1'

function withVersion(raw: string): string {
  return raw.startsWith(`${CACHE_VERSION}:`) ? raw : `${CACHE_VERSION}:${raw}`
}

function logCacheError(op: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err)
  console.warn(`[cache] ${op} falhou: ${message}`)
}

export const cache = {
  key(
    module: string,
    ...parts: (string | number | undefined | null)[]
  ): string {
    return withVersion([module, ...parts.map((p) => p ?? 'all')].join(':'))
  },

  async get<T>(key: string): Promise<T | null> {
    if (!redis) return null

    try {
      const data = await redis.get(key)
      if (!data) return null
      return JSON.parse(data) as T
    } catch (err) {
      logCacheError('get', err)
      return null
    }
  },

  async set(key: string, value: unknown, ttlInSeconds = 60): Promise<void> {
    if (!redis) return

    try {
      const data = JSON.stringify(value)
      if (data === undefined) return
      await redis.set(key, data, 'EX', ttlInSeconds)
    } catch (err) {
      logCacheError('set', err)
    }
  },

  async invalidate(pattern: string): Promise<void> {
    if (!redis) return
    const client = redis

    const versioned = withVersion(pattern)
    const stream = client.scanStream({ match: versioned, count: 100 })
    const pending: Promise<unknown>[] = []

    try {
      await new Promise<void>((resolve, reject) => {
        stream.on('data', (keys: string[]) => {
          if (keys.length === 0) return
          stream.pause()
          const pipeline = client.pipeline()
          for (const k of keys) pipeline.del(k)
          const exec = pipeline
            .exec()
            .catch((err) => logCacheError('invalidate:del', err))
            .finally(() => stream.resume())
          pending.push(exec)
        })
        stream.on('end', resolve)
        stream.on('error', reject)
      })
      await Promise.all(pending)
    } catch (err) {
      logCacheError('invalidate', err)
    }
  },

  async del(key: string): Promise<void> {
    if (!redis) return

    try {
      await redis.del(key)
    } catch (err) {
      logCacheError('del', err)
    }
  },
}
