import type { FastifyReply, FastifyRequest } from 'fastify'
import type { LoginBody, MfaCodeBody, RefreshBody } from './auth.schema'
import {
  disableMfa,
  enableMfa,
  markRefreshTokenRotated,
  revokeAllSessions,
  revokeRefreshTokenForUser,
  rotateRefreshToken,
  setupMfa,
  validateLogin,
} from './auth.service'
import { issueSession, type SessionMeta } from './auth.session'

// Metadados da requisição gravados junto ao refresh token (auditoria de sessão).
function sessionMeta(request: FastifyRequest): SessionMeta {
  return { userAgent: request.headers['user-agent'] ?? null, ip: request.ip }
}

export async function login(request: FastifyRequest, reply: FastifyReply) {
  const result = await validateLogin(request.body as LoginBody)
  if (result.status === 'mfa_required') {
    // Senha OK, mas a conta tem MFA: o cliente reapresenta o form pedindo o código.
    return reply.send({ mfaRequired: true })
  }
  if (result.status === 'mfa_setup_required') {
    // Admin sem MFA: emite um token de matrícula de curta duração (só autoriza
    // /auth/mfa/setup e /auth/mfa/enable) — sem sessão até o cadastro concluir.
    const enrollmentToken = await reply.jwtSign(
      { sub: result.user.id, mfaEnrollment: true },
      { expiresIn: '15m' },
    )
    return reply.send({ mfaSetupRequired: true, enrollmentToken })
  }
  const { token, refreshToken } = await issueSession(
    reply,
    result.user.id,
    sessionMeta(request),
  )
  request.log.info({ userId: result.user.id }, 'User logged in')
  return reply.send({ token, refreshToken })
}

// Rotaciona o refresh: valida o atual, emite um par novo e revoga o anterior
// (encadeando a rotação). Reuso de token rotacionado derruba todas as sessões.
export async function refresh(request: FastifyRequest, reply: FastifyReply) {
  const { refreshToken: presented } = request.body as RefreshBody
  const { userId, previousTokenId } = await rotateRefreshToken(presented)
  const session = await issueSession(reply, userId, sessionMeta(request))
  await markRefreshTokenRotated(previousTokenId, session.refreshTokenId)
  return reply.send({ token: session.token, refreshToken: session.refreshToken })
}

// Logout: revoga o refresh apresentado (a sessão atual). Idempotente.
export async function logout(request: FastifyRequest, reply: FastifyReply) {
  const { refreshToken: presented } = request.body as RefreshBody
  await revokeRefreshTokenForUser(presented, request.user.sub)
  return reply.send({ ok: true })
}

// Logout global: encerra todas as sessões do usuário em todos os dispositivos.
export async function logoutAll(request: FastifyRequest, reply: FastifyReply) {
  await revokeAllSessions(request.user.sub)
  return reply.send({ ok: true })
}

export async function postMfaSetup(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const result = await setupMfa(request.user.sub)
  return reply.send(result)
}

export async function postMfaEnable(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { code } = request.body as MfaCodeBody
  const result = await enableMfa(request.user.sub, code)
  return reply.send(result)
}

export async function postMfaDisable(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { code } = request.body as MfaCodeBody
  const result = await disableMfa(request.user.sub, code)
  return reply.send(result)
}
