import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { reconcilerLockTtl, runWithLock } from './leader-lock'
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

beforeEach(async () => {
  await redis.flushdb()
})

afterAll(async () => {
  await redis.flushdb()
})

describe('runWithLock', () => {
  it('executa fn quando adquire o lock e retorna o valor', async () => {
    const result = await runWithLock('job-a', 1000, async () => 42)
    expect(result).toBe(42)
  })

  it('libera o lock após terminar (próximo tick concorre de novo)', async () => {
    await runWithLock('job-a', 5000, async () => 'x')
    const ttl = await redis.pttl('lock:reconciler:job-a')
    // -2 = chave não existe (liberada no finally).
    expect(ttl).toBe(-2)
  })

  it('só uma execução vence quando dois ticks concorrem na mesma chave', async () => {
    let runs = 0
    // Segura o primeiro até o segundo tentar adquirir, garantindo concorrência.
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const first = runWithLock('job-b', 5000, async () => {
      await gate
      runs++
      return 'first'
    })
    const second = runWithLock('job-b', 5000, async () => {
      runs++
      return 'second'
    })

    // O segundo não consegue o lock e retorna sem rodar fn.
    expect(await second).toBeUndefined()
    release()
    expect(await first).toBe('first')
    expect(runs).toBe(1)
  })

  it('libera o lock mesmo quando fn lança', async () => {
    await expect(
      runWithLock('job-c', 5000, async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    const ttl = await redis.pttl('lock:reconciler:job-c')
    expect(ttl).toBe(-2)
  })
})

describe('reconcilerLockTtl', () => {
  it('usa o intervalo menos a folga, com piso de 5s', () => {
    expect(reconcilerLockTtl(8_000)).toBe(5_000)
    expect(reconcilerLockTtl(1_000)).toBe(5_000)
  })

  it('limita o TTL a no máximo 60s para intervalos longos', () => {
    expect(reconcilerLockTtl(3_600_000)).toBe(60_000)
  })
})
