import type { FastifyInstance } from 'fastify'
import { login, me } from './auth.controller'
import { loginBodySchema } from './auth.schema'

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/login', { schema: { body: loginBodySchema } }, login)

  app.get('/auth/me', { onRequest: [app.authenticate] }, me)
}
