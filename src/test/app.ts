import fastifyJwt from '@fastify/jwt'
import fastifyMultipart from '@fastify/multipart'
import { fastifyRateLimit } from '@fastify/rate-limit'
import { type FastifyReply, type FastifyRequest, fastify } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { handlePrismaUniqueError } from '../lib/errors'
import { redis } from '../lib/redis'
import { attendanceRoutes } from '../modules/attendance/attendance.routes'
import { authRoutes } from '../modules/auth/auth.routes'
import { commentsRoutes } from '../modules/comments/comments.routes'
import { eventInvitesRoutes } from '../modules/event-invites/event-invites.routes'
import { eventsRoutes } from '../modules/events/events.routes'
import { featuredEventsRoutes } from '../modules/featured-events/featured-events.routes'
import { feedRoutes } from '../modules/feed/feed.routes'
import { followsRoutes } from '../modules/follows/follows.routes'
import { healthRoutes } from '../modules/health/health.routes'
import { postsRoutes } from '../modules/posts/posts.routes'
import { reactionsRoutes } from '../modules/reactions/reactions.routes'
import { reportsRoutes } from '../modules/reports/reports.routes'
import { socialAuthRoutes } from '../modules/social-auth/social-auth.routes'
import { usersRoutes } from '../modules/users/users.routes'

export function buildApp() {
  const app = fastify().withTypeProvider<ZodTypeProvider>()

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  app.setErrorHandler((error: Error, request, reply) => {
    const uniqueErr = handlePrismaUniqueError(error)
    if (uniqueErr) {
      return reply
        .status(uniqueErr.statusCode)
        .send({ message: uniqueErr.message })
    }
    const explicit = error as { statusCode?: number; message?: string }
    if (explicit.statusCode && explicit.statusCode < 500) {
      return reply
        .status(explicit.statusCode)
        .send({ message: explicit.message ?? 'Erro' })
    }
    request.log.error({ err: error }, 'Unhandled error')
    return reply.status(500).send({
      message:
        process.env.NODE_ENV === 'production'
          ? 'Erro interno do servidor.'
          : (error.message ?? 'Internal Server Error'),
    })
  })

  app.register(fastifyRateLimit, {
    global: false,
    redis: redis ?? undefined,
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

  app.register(healthRoutes)
  app.register(authRoutes)
  app.register(socialAuthRoutes)
  app.register(eventsRoutes)
  app.register(featuredEventsRoutes)
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
