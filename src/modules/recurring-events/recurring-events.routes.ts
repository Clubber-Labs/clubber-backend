import type { FastifyInstance } from 'fastify'
import { deleteSeriesHandler } from './recurring-events.controller'
import { seriesParamsSchema } from './recurring-events.schema'

export async function recurringEventsRoutes(app: FastifyInstance) {
  // Sem requirePremium: quem perdeu o premium ainda precisa poder cancelar a
  // série que criou (mesmo racional do DELETE de featured-events).
  app.delete(
    '/events/series/:seriesId',
    {
      schema: { params: seriesParamsSchema },
      onRequest: [app.authenticate],
    },
    deleteSeriesHandler,
  )
}
