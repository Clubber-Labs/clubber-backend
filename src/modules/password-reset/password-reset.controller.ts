import type { FastifyReply, FastifyRequest } from 'fastify'
import type {
  ForgotPasswordBody,
  ResetPasswordBody,
} from './password-reset.schema'
import { requestPasswordReset, resetPassword } from './password-reset.service'

export async function forgotPassword(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  await requestPasswordReset(request.body as ForgotPasswordBody)
  // Sempre 200 — sem enumeração de usuários.
  return reply.send({ message: 'Se o email existir, enviaremos um código.' })
}

export async function resetPasswordController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  await resetPassword(request.body as ResetPasswordBody)
  return reply.send({ message: 'Senha redefinida com sucesso.' })
}
