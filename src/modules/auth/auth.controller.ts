import type { FastifyReply, FastifyRequest } from 'fastify'
import { captureDeviceContext } from '../users/users.service'
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
  const body = request.body as LoginBody
  const result = await validateLogin(body)
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
  await captureDeviceContext(
    result.user.id,
    request.headers['accept-language'],
    body.timezone,
  )
  request.log.info({ userId: result.user.id }, 'User logged in')
  return reply.send({ token, refreshToken })
}

// Rotaciona o refresh: valida o atual e emite um par novo. Na rotação normal,
// encadeia o sucessor (auditoria da cadeia). No caso `grace` (reapresentação
// benigna dentro da janela — refresh concorrente/retry), só reemite a sessão sem
// encadear nem derrubar nada. Reuso de token rotacionado FORA da janela derruba
// todas as sessões (ver rotateRefreshToken).
export async function refresh(request: FastifyRequest, reply: FastifyReply) {
  const { refreshToken: presented } = request.body as RefreshBody
  const result = await rotateRefreshToken(presented)
  const session = await issueSession(reply, result.userId, sessionMeta(request))
  if (result.kind === 'rotated') {
    await markRefreshTokenRotated(
      result.previousTokenId,
      session.refreshTokenId,
    )
  }
  // `grace`: NÃO encadeia de propósito — o token reemitido é "irmão", não
  // sucessor (replacedByTokenId fica null). Trade-off aceito: a sessão fica
  // órfã na cadeia de rotação (mais difícil de rastrear numa auditoria) em
  // troca de não deslogar o usuário em refresh concorrente. Não é bug.
  return reply.send({
    token: session.token,
    refreshToken: session.refreshToken,
  })
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
