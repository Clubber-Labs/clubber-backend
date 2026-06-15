import '@fastify/jwt'
import type { FastifyReply, FastifyRequest } from 'fastify'

declare module '@fastify/jwt' {
  interface FastifyJWT {
    // `mfaEnrollment` marca o token de matrícula de MFA (curta duração, só vale
    // para o cadastro do segundo fator) — ausente nos tokens de sessão normais.
    payload: { sub: string; mfaEnrollment?: boolean }
    user: { sub: string; mfaEnrollment?: boolean }
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>
    authenticateOptional(
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<void>
    authenticateMfaSetup(
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<void>
  }
}
