import { createHash, randomBytes } from 'node:crypto'
import type { FastifyReply } from 'fastify'
import { env } from '../../lib/env'
import { createRefreshToken } from './auth.repository'

const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
}

// Converte a duração no formato do env (regex `\d+[smhd]` ou `\d+` = segundos)
// para milissegundos. Usado para calcular o `expiresAt` do refresh token.
export function durationToMs(value: string): number {
  const match = value.match(/^(\d+)([smhd])?$/)
  if (!match) throw new Error(`Duração inválida: ${value}`)
  const amount = Number(match[1])
  const unit = match[2]
  return unit ? amount * UNIT_MS[unit] : amount * 1_000
}

// O refresh token é opaco (não-JWT). Guardamos só o hash SHA-256 no banco; o
// valor bruto só existe na resposta ao cliente — assim um dump do banco não
// concede sessões.
export function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export type SessionMeta = { userAgent?: string | null; ip?: string | null }

// Emite um par de sessão: access token JWT curto (TTL do plugin via
// JWT_EXPIRES_IN) + refresh token opaco longo, persistido (hash) e revogável.
// Retorna também o id do refresh recém-criado para encadear a rotação.
export async function issueSession(
  reply: FastifyReply,
  userId: string,
  meta: SessionMeta = {},
) {
  const token = await reply.jwtSign({ sub: userId })
  const refreshToken = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + durationToMs(env.REFRESH_TOKEN_EXPIRES_IN))
  const record = await createRefreshToken({
    userId,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt,
    userAgent: meta.userAgent ?? null,
    ip: meta.ip ?? null,
  })
  return { token, refreshToken, refreshTokenId: record.id }
}
