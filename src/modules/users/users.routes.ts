import type { FastifyInstance } from 'fastify'
import { postUser } from './users.controller'
import { createUserSchema } from './users.schema'

export async function usersRoutes(app: FastifyInstance) {
  app.post('/users', { schema: { body: createUserSchema } }, postUser)
}
