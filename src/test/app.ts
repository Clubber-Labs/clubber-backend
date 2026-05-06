import fastifyJwt from '@fastify/jwt'
import fastifyMultipart from '@fastify/multipart'
import { type FastifyReply, type FastifyRequest, fastify } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { attendanceRoutes } from '../modules/attendance/attendance.routes'
import { authRoutes } from '../modules/auth/auth.routes'
import { commentsRoutes } from '../modules/comments/comments.routes'
import { eventInvitesRoutes } from '../modules/event-invites/event-invites.routes'
import { eventsRoutes } from '../modules/events/events.routes'
import { feedRoutes } from '../modules/feed/feed.routes'
import { followsRoutes } from '../modules/follows/follows.routes'
import { postsRoutes } from '../modules/posts/posts.routes'
import { reactionsRoutes } from '../modules/reactions/reactions.routes'
import { reportsRoutes } from '../modules/reports/reports.routes'
import { usersRoutes } from '../modules/users/users.routes'

export function buildApp() {
  const app = fastify().withTypeProvider<ZodTypeProvider>()

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  app.setErrorHandler((error: Error, _request, reply) => {
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500
    const message = error.message ?? 'Internal Server Error'
    reply.status(statusCode).send({ message })
  })

  app.register(fastifyMultipart, { limits: { fileSize: 5 * 1024 * 1024 } })

  app.register(fastifyJwt, {
    secret: process.env.JWT_SECRET ?? 'test_secret',
  })

  app.decorate(
    'authenticate',
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const payload = await request.jwtVerify<{ sub: string }>()
      request.user = payload
    },
  )

  app.decorate(
    'authenticateOptional',
    async (request: FastifyRequest, _reply: FastifyReply) => {
      if (request.headers.authorization) {
        const payload = await request.jwtVerify<{ sub: string }>()
        request.user = payload
      }
    },
  )

  app.register(authRoutes)
  app.register(eventsRoutes)
  app.register(usersRoutes)
  app.register(followsRoutes)
  app.register(attendanceRoutes)
  app.register(postsRoutes)
  app.register(commentsRoutes)
  app.register(reactionsRoutes)
  app.register(feedRoutes)
  app.register(eventInvitesRoutes)
  app.register(reportsRoutes)

  return app
}
