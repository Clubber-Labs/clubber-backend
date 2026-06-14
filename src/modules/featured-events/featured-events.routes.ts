import type { FastifyInstance } from 'fastify'
import { requirePremium } from '../billing/billing.middleware'
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
      // requirePremium roda DEPOIS de authenticate. Defesa em depth:
      // bloqueia 99% das tentativas de não-premium antes de tocar a lógica.
      // O service ainda valida `event.author.isPremium` + autoria — necessário
      // pra garantir que o autor do evento (não o requester) é premium e
      // pra cobrir o caso de race entre downgrade do user e o POST.
      onRequest: [app.authenticate, requirePremium],
    },
    postFeaturedEvent,
  )

  // DELETE NÃO exige premium: usuário que perdeu premium ainda precisa
  // poder cancelar destaques que criou quando era premium.
  app.delete(
    '/events/:id/featured/:featureId',
    {
      schema: { params: featuredEventFeatureParamsSchema },
      onRequest: [app.authenticate],
    },
    deleteFeaturedEvent,
  )
}
