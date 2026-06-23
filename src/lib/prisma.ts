import { PrismaClient } from '@prisma/client'
import { env } from './env'

// Resolve a URL de runtime do Prisma a partir do ambiente. Quando
// DATABASE_POOL_URL está setada (PgBouncer em transaction mode), conecta por ela
// e desabilita prepared statements (pgbouncer=true) — obrigatório, pois o
// transaction mode reaproveita conexões de servidor entre clientes e quebra
// prepared statements nomeados. Sem DATABASE_POOL_URL, mantém o comportamento
// atual (Postgres direto via DATABASE_URL, com prepared statements). Migrations
// continuam usando DATABASE_URL (direta) — pooling em transaction mode não
// suporta DDL/advisory locks.
function buildRuntimeUrl(): string {
  const base = env.DATABASE_POOL_URL ?? env.DATABASE_URL
  const url = new URL(base)
  if (env.DATABASE_POOL_URL) url.searchParams.set('pgbouncer', 'true')
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

export const prisma = new PrismaClient({ datasourceUrl: buildRuntimeUrl() })
