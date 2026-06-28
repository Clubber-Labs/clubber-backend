import type { FastifyInstance } from 'fastify'
import { isBlocked as defaultIsBlocked } from './moderation-denylist'

export type WsClaims = { sub: string; exp?: number; mfaEnrollment?: boolean }

/**
 * Autoriza o handshake de um WebSocket a partir do token na query.
 *
 * Espelha o decorator REST `authenticate` (lib/auth-decorators): o JWT do
 * projeto não expira no handshake, então um token de conta suspensa/banida
 * ainda verifica — a denylist de moderação barra a sessão existente. Antes
 * disso o handshake só fazia `jwt.verify`, deixando banido/suspenso operar no
 * tempo real (chat/notificações). Também recusa o token de matrícula de MFA,
 * que não vale como sessão.
 *
 * Retorna os claims quando autorizado, ou `null` quando o token é inválido, é
 * de matrícula de MFA, ou a conta está bloqueada — o gateway fecha o socket.
 * `isBlocked` é injetável para teste (sem Redis).
 */
export async function authenticateWsToken(
  app: FastifyInstance,
  token: string,
  isBlocked: (userId: string) => Promise<boolean> = defaultIsBlocked,
): Promise<WsClaims | null> {
  let claims: WsClaims
  try {
    claims = app.jwt.verify<WsClaims>(token)
  } catch {
    return null
  }
  if (claims.mfaEnrollment) return null
  if (await isBlocked(claims.sub)) return null
  return claims
}
