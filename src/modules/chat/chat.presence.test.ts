import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { redis as nullableRedis } from '../../lib/redis'
import {
  presenceConnect,
  presenceDisconnect,
  presenceRefresh,
} from './chat.presence'

if (!nullableRedis) {
  throw new Error(
    'REDIS_URL deve estar configurada em .env.test para esses testes',
  )
}

const redis = nullableRedis

beforeEach(async () => {
  await redis.flushdb()
})

afterAll(async () => {
  await redis.flushdb()
})

describe('contador de presença distribuído', () => {
  it('conta conexões agregadas (online só na 1ª, sem reanunciar nas demais)', async () => {
    // Simula 2 abas/instâncias do mesmo usuário: só a primeira é a transição.
    expect(await presenceConnect('u1')).toBe(1)
    expect(await presenceConnect('u1')).toBe(2)
  })

  it('decrementa e só zera quando a última conexão cai', async () => {
    await presenceConnect('u1')
    await presenceConnect('u1') // 2 conexões

    expect(await presenceDisconnect('u1')).toBe(1) // ainda online
    expect(await presenceDisconnect('u1')).toBe(0) // última caiu → offline
  })

  it('faz floor em 0: desconexão sem conexão prévia não trava a presença', async () => {
    expect(await presenceDisconnect('u1')).toBe(0)
    expect(await redis.exists('ws:presence:u1')).toBe(0)
  })

  it('define e renova o TTL do contador', async () => {
    await presenceConnect('u1')
    const ttl = await redis.ttl('ws:presence:u1')
    expect(ttl).toBeGreaterThan(0)

    await presenceRefresh('u1')
    expect(await redis.ttl('ws:presence:u1')).toBeGreaterThan(0)
  })
})
