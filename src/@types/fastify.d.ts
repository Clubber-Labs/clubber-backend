import '@fastify/jwt'
import { UserRole } from '@prisma/client'
import type { FastifyReply, FastifyRequest } from 'fastify'

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string, role: UserRole }
    user: { sub: string, role: UserRole }
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>
    authenticateAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void>
    authenticateOptional(
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<void>
  }
}
