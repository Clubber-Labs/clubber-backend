import { fastifyCors } from '@fastify/cors'
import fastifyJwt from '@fastify/jwt'
import fastifyMultipart from '@fastify/multipart'
import { fastifyRateLimit } from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import { fastifySwagger } from '@fastify/swagger'
import ScalarApiReference from '@scalar/fastify-api-reference'
import { type FastifyReply, type FastifyRequest, fastify } from 'fastify'
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { env } from './lib/env'
import { errorHandler } from './lib/error-handler'
import { sanitizeLogUrl } from './lib/logger'
import { redis } from './lib/redis'
import { attendanceRoutes } from './modules/attendance/attendance.routes'
import { authRoutes } from './modules/auth/auth.routes'
import { blocksRoutes } from './modules/blocks/blocks.routes'
import { categoriesRoutes } from './modules/categories/categories.routes'
import { chatGateway } from './modules/chat/chat.gateway'
import { chatRoutes } from './modules/chat/chat.routes'
import { commentsRoutes } from './modules/comments/comments.routes'
import { eventInvitesRoutes } from './modules/event-invites/event-invites.routes'
import { eventsRoutes } from './modules/events/events.routes'
import { startFeaturedEventsReconciler } from './modules/featured-events/featured-events.reconciler'
import { featuredEventsRoutes } from './modules/featured-events/featured-events.routes'
import { feedRoutes } from './modules/feed/feed.routes'
import { followsRoutes } from './modules/follows/follows.routes'
import { healthRoutes } from './modules/health/health.routes'
import { postsRoutes } from './modules/posts/posts.routes'
import { reactionsRoutes } from './modules/reactions/reactions.routes'
import { reportsRoutes } from './modules/reports/reports.routes'
import { socialAuthRoutes } from './modules/social-auth/social-auth.routes'
import { usersRoutes } from './modules/users/users.routes'

const isDev = env.NODE_ENV === 'development'

const app = fastify({
  logger: {
    level: env.LOG_LEVEL,
    serializers: {
      err: (err: Error) => ({
        type: err.constructor.name,
        message: err.message,
        stack: err.stack ?? '',
        ...((err as { code?: string }).code && {
          code: (err as { code?: string }).code,
        }),
      }),
      req: (req) => ({
        method: req.method,
        url: sanitizeLogUrl(req.url),
      }),
      res: (res) => ({
        statusCode: res.statusCode,
      }),
    },
    ...(isDev && {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss',
          ignore: 'pid,hostname,reqId,module',
          messageFormat: '{if module}[{module}] {end}{msg}',
          singleLine: false,
        },
      },
    }),
  },
}).withTypeProvider<ZodTypeProvider>()

app.setValidatorCompiler(validatorCompiler)
app.setSerializerCompiler(serializerCompiler)

app.setErrorHandler(errorHandler)

app.register(fastifyCors, {
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,
})

app.register(fastifyRateLimit, {
  global: false,
  redis: redis ?? undefined,
})

app.register(fastifyMultipart, {
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
})

if (env.STORAGE_DRIVER === 'local') {
  app.register(fastifyStatic, {
    root: env.UPLOADS_DIR,
    prefix: '/uploads/',
  })
}

app.register(fastifyJwt, {
  secret: env.JWT_SECRET,
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

app.register(fastifySwagger, {
  openapi: {
    info: {
      title: 'ConnectAI API',
      description: 'API documentation for ConnectAI backend',
      version: '1.0.0',
    },
  },
  transform: jsonSchemaTransform,
})

app.register(ScalarApiReference, {
  routePrefix: '/docs',
})

app.register(healthRoutes)
app.register(authRoutes)
app.register(socialAuthRoutes)
app.register(categoriesRoutes)
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
app.register(blocksRoutes)
app.register(chatRoutes)
app.register(chatGateway)

app.addHook('onClose', async () => {
  if (redis) await redis.quit()
})

let shuttingDown = false
async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return
  shuttingDown = true
  try {
    await app.close()
    process.exit(0)
  } catch (err) {
    app.log.error({ err, signal }, 'erro durante shutdown')
    process.exit(1)
  }
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)

app.listen({ port: env.PORT, host: '0.0.0.0' }).then(() => {
  app.log.info(`Server is running on http://localhost:${env.PORT}`)
  if (env.NODE_ENV !== 'test' && env.FEATURED_RECONCILE_ENABLED) {
    startFeaturedEventsReconciler(env.FEATURED_RECONCILE_INTERVAL_MS)
  }
})
