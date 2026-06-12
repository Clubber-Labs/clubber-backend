// Observabilidade: DEVE ser o primeiro import (instrumenta http/pg/Prisma/etc.
// antes deles serem carregados). A linha em branco abaixo mantém este import
// no próprio grupo, fora do alcance do organizeImports do Biome.
import './instrumentation'

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
import { shutdownInstrumentation } from './instrumentation'
import { env } from './lib/env'
import { errorHandler } from './lib/error-handler'
import { buildLoggerOptions } from './lib/logger'
import { redis } from './lib/redis'
import { genReqId } from './lib/request-id'
import { attendanceRoutes } from './modules/attendance/attendance.routes'
import { authRoutes } from './modules/auth/auth.routes'
import {
  billingRoutes,
  billingWebhookRoutes,
} from './modules/billing/billing.routes'
import { startBillingRetentionReconciler } from './modules/billing/billing-retention.reconciler'
import { startBillingSyncReconciler } from './modules/billing/billing-sync.reconciler'
import { blocksRoutes } from './modules/blocks/blocks.routes'
import { categoriesRoutes } from './modules/categories/categories.routes'
import { chatGateway } from './modules/chat/chat.gateway'
import { chatRoutes } from './modules/chat/chat.routes'
import { commentsRoutes } from './modules/comments/comments.routes'
import { consentRoutes } from './modules/consent/consent.routes'
import { eventInvitesRoutes } from './modules/event-invites/event-invites.routes'
import { eventsRoutes } from './modules/events/events.routes'
import { startFeaturedEventsReconciler } from './modules/featured-events/featured-events.reconciler'
import { featuredEventsRoutes } from './modules/featured-events/featured-events.routes'
import { feedRoutes } from './modules/feed/feed.routes'
import { followsRoutes } from './modules/follows/follows.routes'
import { healthRoutes } from './modules/health/health.routes'
import { startLocationRetentionReconciler } from './modules/notifications/location-retention.reconciler'
import {
  startNotificationsWorker,
  stopNotificationsWorker,
} from './modules/notifications/notification-queue'
import { startNotificationRetentionReconciler } from './modules/notifications/notification-retention.reconciler'
import { notificationsGateway } from './modules/notifications/notifications.gateway'
import { notificationsRoutes } from './modules/notifications/notifications.routes'
import { startPushReceiptsReconciler } from './modules/notifications/push-receipts.reconciler'
import { startSpotLifecycleReconciler } from './modules/notifications/spot-lifecycle.reconciler'
import { startPasswordResetCleanupReconciler } from './modules/password-reset/password-reset.reconciler'
import { passwordResetRoutes } from './modules/password-reset/password-reset.routes'
import { postsRoutes } from './modules/posts/posts.routes'
import { reactionsRoutes } from './modules/reactions/reactions.routes'
import { reportsRoutes } from './modules/reports/reports.routes'
import { socialAuthRoutes } from './modules/social-auth/social-auth.routes'
import { spotsRoutes } from './modules/spots/spots.routes'
import { startAccountDeletionReconciler } from './modules/users/account-deletion.reconciler'
import { usersRoutes } from './modules/users/users.routes'
import { metricsPlugin } from './plugins/metrics'
import { requestIdPlugin } from './plugins/request-id'

const app = fastify({
  // genReqId valida/reaproveita o x-request-id de entrada (ver lib/request-id).
  // requestIdHeader: false desliga a leitura automática do Fastify para que toda
  // a validação fique centralizada no genReqId.
  genReqId,
  requestIdHeader: false,
  // Opções compartilhadas com o logger standalone (lib/logger) — redaction,
  // serializers e destino (stdout/pretty/Loki) num único lugar, sem drift.
  logger: buildLoggerOptions(),
}).withTypeProvider<ZodTypeProvider>()

app.setValidatorCompiler(validatorCompiler)
app.setSerializerCompiler(serializerCompiler)

app.setErrorHandler(errorHandler)

app.register(requestIdPlugin)
app.register(metricsPlugin)

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
app.register(passwordResetRoutes)
app.register(categoriesRoutes)
app.register(eventsRoutes)
app.register(featuredEventsRoutes)
app.register(usersRoutes)
app.register(consentRoutes)
app.register(followsRoutes)
app.register(attendanceRoutes)
app.register(postsRoutes)
app.register(commentsRoutes)
app.register(reactionsRoutes)
app.register(feedRoutes)
app.register(eventInvitesRoutes)
app.register(reportsRoutes)
app.register(billingRoutes)
// Webhook em plugin separado pra raw body ser ativado apenas nele.
app.register(billingWebhookRoutes)
app.register(blocksRoutes)
app.register(chatRoutes)
app.register(spotsRoutes)
app.register(notificationsRoutes)
app.register(chatGateway)
app.register(notificationsGateway)

app.addHook('onClose', async () => {
  await stopNotificationsWorker()
  if (redis) await redis.quit()
})

let shuttingDown = false
async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return
  shuttingDown = true
  try {
    await app.close()
    await shutdownInstrumentation()
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
  if (env.NODE_ENV !== 'test' && env.ACCOUNT_DELETION_ENABLED) {
    startAccountDeletionReconciler(env.ACCOUNT_DELETION_INTERVAL_MS)
  }
  if (
    env.NODE_ENV !== 'test' &&
    env.BILLING_WEBHOOK_RETENTION_CLEANUP_ENABLED
  ) {
    startBillingRetentionReconciler(
      env.BILLING_WEBHOOK_RETENTION_CLEANUP_INTERVAL_MS,
      env.BILLING_WEBHOOK_RETENTION_DAYS,
    )
  }
  if (env.NODE_ENV !== 'test' && env.BILLING_SYNC_ENABLED) {
    startBillingSyncReconciler(
      env.BILLING_SYNC_INTERVAL_MS,
      env.BILLING_SYNC_GRACE_MS,
    )
  }
  if (env.NODE_ENV !== 'test' && env.PASSWORD_RESET_CLEANUP_ENABLED) {
    startPasswordResetCleanupReconciler(env.PASSWORD_RESET_CLEANUP_INTERVAL_MS)
  }
  if (env.NODE_ENV !== 'test' && env.NOTIFY_RETENTION_CLEANUP_ENABLED) {
    startNotificationRetentionReconciler(
      env.NOTIFY_RETENTION_CLEANUP_INTERVAL_MS,
      env.NOTIFY_RETENTION_DAYS,
    )
  }
  if (env.NODE_ENV !== 'test' && env.NOTIFY_LOCATION_CLEANUP_ENABLED) {
    startLocationRetentionReconciler(
      env.NOTIFY_LOCATION_CLEANUP_INTERVAL_MS,
      env.NOTIFY_LOCATION_TTL_DAYS,
    )
  }
  if (env.NODE_ENV !== 'test' && env.SPOT_LIFECYCLE_ENABLED) {
    startSpotLifecycleReconciler(
      env.SPOT_LIFECYCLE_INTERVAL_MS,
      env.SPOT_RENEWAL_LEAD_MS,
    )
  }
  if (env.NODE_ENV !== 'test' && env.NOTIFICATIONS_ENABLED) {
    startNotificationsWorker()
    if (env.NOTIFY_RECEIPTS_ENABLED) {
      startPushReceiptsReconciler(
        env.NOTIFY_RECEIPTS_INTERVAL_MS,
        env.NOTIFY_RECEIPTS_DELAY_MS,
      )
    }
  }
})
