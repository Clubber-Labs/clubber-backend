import fastifyJwt from '@fastify/jwt'
import fastifyMultipart from '@fastify/multipart'
import { fastifyRateLimit } from '@fastify/rate-limit'
import { fastify } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { registerAuthDecorators } from '../lib/auth-decorators'
import { env } from '../lib/env'
import { errorHandler } from '../lib/error-handler'
import { redis } from '../lib/redis'
import { genReqId } from '../lib/request-id'
import { adminConsentRoutes } from '../modules/admin-consent/admin-consent.routes'
import { attendanceRoutes } from '../modules/attendance/attendance.routes'
import { authRoutes } from '../modules/auth/auth.routes'
import {
  billingRoutes,
  billingWebhookRoutes,
} from '../modules/billing/billing.routes'
import { blocksRoutes } from '../modules/blocks/blocks.routes'
import { categoriesRoutes } from '../modules/categories/categories.routes'
import { chatRoutes } from '../modules/chat/chat.routes'
import { commentsRoutes } from '../modules/comments/comments.routes'
import { consentRoutes } from '../modules/consent/consent.routes'
import { eventInvitesRoutes } from '../modules/event-invites/event-invites.routes'
import { eventStatsRoutes } from '../modules/event-stats/event-stats.routes'
import { eventsRoutes } from '../modules/events/events.routes'
import { featuredEventsRoutes } from '../modules/featured-events/featured-events.routes'
import { feedRoutes } from '../modules/feed/feed.routes'
import { followsRoutes } from '../modules/follows/follows.routes'
import { healthRoutes } from '../modules/health/health.routes'
import { notificationsRoutes } from '../modules/notifications/notifications.routes'
import { passwordResetRoutes } from '../modules/password-reset/password-reset.routes'
import { postsRoutes } from '../modules/posts/posts.routes'
import { reactionsRoutes } from '../modules/reactions/reactions.routes'
import { reportsRoutes } from '../modules/reports/reports.routes'
import { socialAuthRoutes } from '../modules/social-auth/social-auth.routes'
import { spotsRoutes } from '../modules/spots/spots.routes'
import { usersRoutes } from '../modules/users/users.routes'
import { metricsPlugin } from '../plugins/metrics'
import { requestIdPlugin } from '../plugins/request-id'

export function buildApp() {
  const app = fastify({
    genReqId,
    requestIdHeader: false,
  }).withTypeProvider<ZodTypeProvider>()

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  app.setErrorHandler(errorHandler)
  app.register(requestIdPlugin)
  app.register(metricsPlugin)

  if (env.RATE_LIMIT_ENABLED) {
    app.register(fastifyRateLimit, {
      global: false,
      redis: redis ?? undefined,
    })
  }

  app.register(fastifyMultipart, { limits: { fileSize: 5 * 1024 * 1024 } })

  app.register(fastifyJwt, {
    secret: process.env.JWT_SECRET ?? 'test_secret',
    // Paridade com o server de produção: tokens de sessão expiram (o enrollment
    // de MFA sobrescreve com seu próprio expiresIn no jwtSign).
    sign: { expiresIn: process.env.JWT_EXPIRES_IN ?? '7d' },
  })

  registerAuthDecorators(app)

  app.register(healthRoutes)
  app.register(authRoutes)
  app.register(socialAuthRoutes)
  app.register(passwordResetRoutes)
  app.register(categoriesRoutes)
  app.register(eventsRoutes)
  app.register(eventStatsRoutes)
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
  app.register(billingRoutes)
  app.register(billingWebhookRoutes)
  app.register(blocksRoutes)
  app.register(chatRoutes)
  app.register(spotsRoutes)
  app.register(consentRoutes)
  app.register(adminConsentRoutes)
  app.register(notificationsRoutes)

  return app
}
