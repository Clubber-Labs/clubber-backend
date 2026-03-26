import type { FastifyReply, FastifyRequest } from 'fastify'
import type { CreateUserBody } from './users.schema'
import { registerUser } from './users.service'

export async function postUser(
  request: FastifyRequest<{ Body: CreateUserBody }>,
  reply: FastifyReply,
) {
  const user = await registerUser(request.body)
  return reply.status(201).send(user)
}
