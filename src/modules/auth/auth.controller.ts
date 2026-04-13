import type { FastifyReply, FastifyRequest } from 'fastify'
import type { LoginBody } from './auth.schema'
import { getAuthenticatedUser, validateLogin } from './auth.service'

export async function login(request: FastifyRequest, reply: FastifyReply) {
  const user = await validateLogin(request.body as LoginBody)
  const token = await reply.jwtSign({ sub: user.id })
  return reply.send({ token })
}

export async function me(request: FastifyRequest, reply: FastifyReply) {
  const user = await getAuthenticatedUser(request.user.sub)
  return reply.send(user)
}
