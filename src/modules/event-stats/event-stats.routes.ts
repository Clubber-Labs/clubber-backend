import type { FastifyInstance } from 'fastify'
import { requirePremium } from '../billing/billing.middleware'
import { getEventStatsHandler } from './event-stats.controller'
import { eventStatsParamsSchema, eventStatsSchema } from './event-stats.schema'

export async function eventStatsRoutes(app: FastifyInstance) {
  app.get(
    '/events/:id/stats',
    {
      schema: {
        params: eventStatsParamsSchema,
        response: { 200: eventStatsSchema },
      },
      // requirePremium roda DEPOIS de authenticate (mesma defesa em depth do
      // featured-events); o service revalida autoria + isPremium do autor.
      onRequest: [app.authenticate, requirePremium],
    },
    getEventStatsHandler,
  )
}
