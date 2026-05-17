import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cache } from './cache'
import { redis as nullableRedis } from './redis'

if (!nullableRedis) {
  throw new Error(
    'REDIS_URL deve estar configurada em .env.test para esses testes',
  )
}

const redis = nullableRedis

beforeAll(async () => {
  await redis.flushdb()
})

afterAll(async () => {
  await redis.flushdb()
})

describe('cache.key', () => {
  it('prefixa a chave com a versão atual', () => {
    const key = cache.key('events:public', 'user-1', 'category-x')
    expect(key.startsWith('v1:')).toBe(true)
    expect(key).toBe('v1:events:public:user-1:category-x')
  })

  it('substitui valores undefined/null por "all"', () => {
    const key = cache.key('events:public', undefined, null, 'limit-20')
    expect(key).toBe('v1:events:public:all:all:limit-20')
  })
})

describe('cache.set / cache.get', () => {
  it('faz round-trip de objetos serializáveis', async () => {
    const key = cache.key('roundtrip', 'a')
    await cache.set(key, { foo: 'bar', n: 42 })

    const value = await cache.get<{ foo: string; n: number }>(key)
    expect(value).toEqual({ foo: 'bar', n: 42 })
  })

  it('retorna null quando a chave não existe', async () => {
    const value = await cache.get(cache.key('missing'))
    expect(value).toBeNull()
  })

  it('retorna null quando o valor armazenado não é JSON válido', async () => {
    const key = cache.key('corrupt')
    await redis.set(key, 'not-json{{{')

    const value = await cache.get(key)
    expect(value).toBeNull()
  })

  it('respeita o TTL configurado', async () => {
    const key = cache.key('ttl-test')
    await cache.set(key, 'value', 10)

    const ttl = await redis.ttl(key)
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(10)
  })

  it('não lança quando o valor não é serializável', async () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular

    await expect(
      cache.set(cache.key('circular'), circular),
    ).resolves.toBeUndefined()
  })
})

describe('cache.invalidate', () => {
  it('remove todas as chaves que casam com o pattern', async () => {
    for (let i = 0; i < 5; i++) {
      await cache.set(cache.key('inv', i), { i })
    }
    await cache.set(cache.key('outro', 'x'), { keep: true })

    await cache.invalidate('inv:*')

    const remaining = await redis.keys('v1:inv:*')
    const other = await redis.keys('v1:outro:*')
    expect(remaining).toHaveLength(0)
    expect(other).toHaveLength(1)
  })

  it('aguarda a deleção concluir antes de resolver (sem race)', async () => {
    for (let i = 0; i < 500; i++) {
      await cache.set(cache.key('race', i), 'v')
    }

    await cache.invalidate('race:*')

    const remaining = await redis.keys('v1:race:*')
    expect(remaining).toHaveLength(0)
  })

  it('é no-op quando não há chaves casando', async () => {
    await expect(cache.invalidate('inexistente:*')).resolves.toBeUndefined()
  })
})

describe('cache.del', () => {
  it('remove uma única chave', async () => {
    const key = cache.key('del-test')
    await cache.set(key, 'value')

    await cache.del(key)

    expect(await cache.get(key)).toBeNull()
  })
})
