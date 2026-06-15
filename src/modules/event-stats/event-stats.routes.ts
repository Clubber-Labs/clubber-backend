import type { FastifyInstance } from 'fastify'
import { requirePremium } from '../billing/billing.middleware'
import {
  exportStatsHandler,
  getEventStatsHandler,
  trackShareHandler,
  trackViewHandler,
} from './event-stats.controller'
import {
  type EventStatsParams,
  type EventStatsQuery,
  eventStatsParamsSchema,
  eventStatsQuerySchema,
  eventStatsSchema,
} from './event-stats.schema'

export async function eventStatsRoutes(app: FastifyInstance) {
  app.get<{ Params: EventStatsParams; Querystring: EventStatsQuery }>(
    '/events/:id/stats',
    {
      schema: {
        params: eventStatsParamsSchema,
        querystring: eventStatsQuerySchema,
        response: { 200: eventStatsSchema },
      },
      // requirePremium roda DEPOIS de authenticate (mesma defesa em depth do
      // featured-events); o service revalida autoria + isPremium do autor.
      onRequest: [app.authenticate, requirePremium],
    },
    getEventStatsHandler,
  )

  app.get<{ Params: EventStatsParams }>(
    '/events/:id/stats/export',
    {
      schema: { params: eventStatsParamsSchema },
      onRequest: [app.authenticate, requirePremium],
    },
    exportStatsHandler,
  )

  app.post<{ Params: EventStatsParams }>(
    '/events/:id/analytics/view',
    {
      schema: { params: eventStatsParamsSchema },
      onRequest: [app.authenticate],
    },
    trackViewHandler,
  )

  app.post<{ Params: EventStatsParams }>(
    '/events/:id/analytics/share',
    {
      schema: { params: eventStatsParamsSchema },
      onRequest: [app.authenticate],
    },
    trackShareHandler,
  )
}
