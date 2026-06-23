import { redis } from '../../lib/redis'

// TTL do contador de presença. Maior que ~3× o heartbeat (30s) para sobreviver
// entre os refreshes; se uma instância cair sem decrementar, o contador órfão se
// auto-cura quando todos param de refrescar a chave e o TTL lapsa.
const PRESENCE_TTL_SECONDS = 90

const keyFor = (userId: string) => `ws:presence:${userId}`

// INCR + EXPIRE atômico: retorna o nº GLOBAL de conexões após conectar.
const CONNECT_SCRIPT = `
  local n = redis.call('incr', KEYS[1])
  redis.call('expire', KEYS[1], ARGV[1])
  return n
`

// DECR e zera/expira: retorna o nº GLOBAL de conexões após desconectar. Floor em
// 0 (del) para um contador que derivou negativo não travar a presença.
const DISCONNECT_SCRIPT = `
  local n = redis.call('decr', KEYS[1])
  if n <= 0 then
    redis.call('del', KEYS[1])
    return 0
  end
  redis.call('expire', KEYS[1], ARGV[1])
  return n
`

/**
 * Contador de presença distribuído (entre instâncias). Sob escala horizontal, o
 * registry local de sockets é por processo e não enxerga conexões em outras
 * instâncias — o que quebra a transição online/offline. Este contador no Redis
 * agrega todas as conexões de um usuário.
 *
 * Sem Redis (dev/single-instance), retornam `null` e o gateway cai de volta na
 * transição do registry local — que, num só processo, já é a verdade global.
 */
export async function presenceConnect(userId: string): Promise<number | null> {
  if (!redis) return null
  const n = await redis.eval(
    CONNECT_SCRIPT,
    1,
    keyFor(userId),
    String(PRESENCE_TTL_SECONDS),
  )
  return Number(n)
}

export async function presenceDisconnect(
  userId: string,
): Promise<number | null> {
  if (!redis) return null
  const n = await redis.eval(
    DISCONNECT_SCRIPT,
    1,
    keyFor(userId),
    String(PRESENCE_TTL_SECONDS),
  )
  return Number(n)
}

/** Renova o TTL do contador (chamado no heartbeat) para não expirar em uso. */
export async function presenceRefresh(userId: string): Promise<void> {
  if (!redis) return
  await redis.expire(keyFor(userId), PRESENCE_TTL_SECONDS).catch(() => {})
}
