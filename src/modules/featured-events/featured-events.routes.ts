import type { FastifyInstance } from 'fastify'
import {
  deleteFeaturedEvent,
  postFeaturedEvent,
} from './featured-events.controller'
import {
  createFeaturedEventBodySchema,
  featuredEventFeatureParamsSchema,
  featuredEventParamsSchema,
} from './featured-events.schema'

export async function featuredEventsRoutes(app: FastifyInstance) {
  app.post(
    '/events/:id/featured',
    {
      schema: {
        params: featuredEventParamsSchema,
        body: createFeaturedEventBodySchema,
      },
      onRequest: [app.authenticate],
    },
    postFeaturedEvent,
  )

  app.delete(
    '/events/:id/featured/:featureId',
    {
      schema: { params: featuredEventFeatureParamsSchema },
      onRequest: [app.authenticate],
    },
    deleteFeaturedEvent,
  )
}
