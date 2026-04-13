import type { FastifyInstance } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { getMainFeed } from './feed.controller'
import { feedQuerySchema } from './feed.schema'

export async function feedRoutes(app: FastifyInstance) {
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  const api = app.withTypeProvider<ZodTypeProvider>()

  api.get(
    '/feed',
    {
      schema: { querystring: feedQuerySchema },
      onRequest: [app.authenticate],
    },
    getMainFeed,
  )
}
