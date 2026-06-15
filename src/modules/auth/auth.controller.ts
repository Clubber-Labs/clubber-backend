import type { FastifyReply, FastifyRequest } from 'fastify'
import type { LoginBody, MfaCodeBody } from './auth.schema'
import { disableMfa, enableMfa, setupMfa, validateLogin } from './auth.service'

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
  const token = await reply.jwtSign({ sub: result.user.id })
  request.log.info({ userId: result.user.id }, 'User logged in')
  return reply.send({ token })
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
