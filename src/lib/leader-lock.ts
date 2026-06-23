import { randomUUID } from 'node:crypto'
import { redis } from './redis'

const LOCK_PREFIX = 'lock:reconciler:'

// Libera o lock só se o token ainda for nosso (compare-and-del atômico via Lua):
// evita que, se o TTL expirou e outra instância já readquiriu a chave, a gente
// apague o lock dela.
const RELEASE_SCRIPT = `
  if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
  else
    return 0
  end
`

/**
 * Executa `fn` em no máximo UMA instância por tick, coordenando via Redis.
 *
 * Sob escala horizontal, todo reconciler agendado rodaria em TODAS as instâncias
 * — UPDATEs e fan-out de push duplicados, corridas. Este lock (`SET NX PX`)
 * garante que só quem adquiriu a chave executa; as demais saem sem rodar. O
 * `finally` libera no fim do tick (compare-and-del), então o próximo tick
 * concorre de novo do zero.
 *
 * Sem Redis (dev/single-instance), executa direto — preservando o comportamento
 * atual. Degradação segura: os reconcilers são idempotentes (UPDATE...WHERE,
 * dedup), então uma falha de coordenação nunca piora o status quo.
 *
 * Retorna o valor de `fn` quando executou, ou `undefined` quando outra instância
 * detinha o lock (nada a fazer neste tick).
 */
export async function runWithLock<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  if (!redis) return fn()

  const token = randomUUID()
  const lockKey = `${LOCK_PREFIX}${key}`
  const acquired = await redis.set(lockKey, token, 'PX', ttlMs, 'NX')
  if (acquired !== 'OK') return undefined

  try {
    return await fn()
  } finally {
    // Best-effort: se a release falhar, o TTL expira o lock sozinho.
    await redis.eval(RELEASE_SCRIPT, 1, lockKey, token).catch(() => {})
  }
}

/**
 * TTL do lock derivado do intervalo do reconciler. Curto o bastante para que um
 * holder que caiu libere a chave antes do próximo tick, com teto de 60s para não
 * segurá-la além de um tick normal. O caso saudável não depende do TTL: o
 * `finally` sempre libera ao terminar.
 */
export function reconcilerLockTtl(intervalMs: number): number {
  return Math.min(Math.max(intervalMs - 5_000, 5_000), 60_000)
}
