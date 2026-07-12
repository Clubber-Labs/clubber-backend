import type { FastifyInstance } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { rateLimit } from '../../lib/rate-limit'
import { getAutocomplete, getDetails } from './places.controller'
import {
  placeDetailsParamsSchema,
  placeDetailsQuerySchema,
  placesAutocompleteQuerySchema,
} from './places.schema'

export async function placesRoutes(app: FastifyInstance) {
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  const api = app.withTypeProvider<ZodTypeProvider>()

  // Cada request é billable no Google — o rate-limit corta burst além do que o
  // debounce de 500ms do app já produz numa digitação normal.
  api.get(
    '/places/autocomplete',
    {
      schema: { querystring: placesAutocompleteQuerySchema },
      onRequest: [app.authenticate],
      config: { rateLimit: rateLimit(30) },
    },
    getAutocomplete,
  )

  api.get(
    '/places/:placeId',
    {
      schema: {
        params: placeDetailsParamsSchema,
        querystring: placeDetailsQuerySchema,
      },
      onRequest: [app.authenticate],
      config: { rateLimit: rateLimit(30) },
    },
    getDetails,
  )
}
