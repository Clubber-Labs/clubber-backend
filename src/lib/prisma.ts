import { PrismaClient } from '@prisma/client'
import { env } from './env'

// Anexa os params de pool a uma URL base. `pooled=true` (PgBouncer em
// transaction mode) desabilita prepared statements via pgbouncer=true —
// obrigatório, pois o modo reaproveita conexões de servidor entre clientes e
// quebra prepared statements nomeados.
function withPoolParams(base: string, pooled: boolean): string {
  const url = new URL(base)
  if (pooled) url.searchParams.set('pgbouncer', 'true')
  if (env.DATABASE_CONNECTION_LIMIT) {
    url.searchParams.set(
      'connection_limit',
      String(env.DATABASE_CONNECTION_LIMIT),
    )
  }
  url.searchParams.set(
    'pool_timeout',
    String(env.DATABASE_POOL_TIMEOUT_SECONDS),
  )
  return url.toString()
}

// URL de runtime do primário: via PgBouncer quando DATABASE_POOL_URL está setada,
// senão o Postgres direto (DATABASE_URL). Migrations sempre usam DATABASE_URL.
function runtimeUrl(): string {
  return env.DATABASE_POOL_URL
    ? withPoolParams(env.DATABASE_POOL_URL, true)
    : withPoolParams(env.DATABASE_URL, false)
}

// URL da réplica (read-only), preferindo a versão pooled. null = sem réplica.
function replicaUrl(): string | null {
  if (env.DATABASE_REPLICA_POOL_URL) {
    return withPoolParams(env.DATABASE_REPLICA_POOL_URL, true)
  }
  if (env.DATABASE_REPLICA_URL) {
    return withPoolParams(env.DATABASE_REPLICA_URL, false)
  }
  return null
}

// Cliente PRIMÁRIO: writes, transações (`$transaction`) e todo read sensível a
// lag — read-after-write na mesma request, real-time (chat), auth/refresh token
// e idempotência de billing. Na dúvida, use este.
export const prisma = new PrismaClient({ datasourceUrl: runtimeUrl() })

// Cliente de RÉPLICA (read-only). Use APENAS para leituras viewer-agnósticas,
// lag-tolerantes e cacheáveis: descoberta geo (lib/spatial.ts), fan-out de
// proximidade (background) e listagens públicas. Sem réplica configurada
// (dev/test/single-node ou outage), aponta para o primário — todo repository
// continua seguro e os testes rodam sem mudança.
const replica = replicaUrl()
export const prismaRead: PrismaClient = replica
  ? new PrismaClient({ datasourceUrl: replica })
  : prisma
