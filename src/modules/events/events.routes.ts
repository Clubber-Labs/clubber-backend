import type { FastifyInstance } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { rateLimit } from '../../lib/rate-limit'
import {
  deleteEventHandler,
  getEvent,
  getEvents,
  getEventsMap,
  getEventsSearch,
  getEventsViewport,
  postEvent,
  putEvent,
  uploadEventImageHandler,
} from './events.controller'
import {
  createEventSchema,
  eventParamSchema,
  listEventsQuerySchema,
  mapEventsQuerySchema,
  searchEventsQuerySchema,
  updateEventSchema,
  viewportQuerySchema,
} from './events.schema'

export async function eventsRoutes(app: FastifyInstance) {
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  const api = app.withTypeProvider<ZodTypeProvider>()

  api.get(
    '/events',
    {
      schema: { querystring: listEventsQuerySchema },
      onRequest: [app.authenticateOptional],
      // Rota pública (auth opcional) que roda ranking espacial; sem teto, vira
      // flood não autenticado de queries caras. Generoso (carga inicial + refresh).
      config: { rateLimit: rateLimit(120) },
    },
    getEvents,
  )

  api.get(
    '/events/map',
    {
      schema: { querystring: mapEventsQuerySchema },
      onRequest: [app.authenticateOptional],
      // Heatmap espacial público; mesmo motivo do /events.
      config: { rateLimit: rateLimit(120) },
    },
    getEventsMap,
  )

  api.get(
    '/events/map/events',
    {
      schema: { querystring: viewportQuerySchema },
      onRequest: [app.authenticateOptional],
      // Mais pesado que a lista/heatmap (window function + hidratação completa).
      // Limite generoso: cobre panning com debounce, barra abuso/scripts.
      config: { rateLimit: rateLimit(240) },
    },
    getEventsViewport,
  )

  api.get(
    '/events/search',
    {
      schema: { querystring: searchEventsQuerySchema },
      onRequest: [app.authenticateOptional],
      config: { rateLimit: rateLimit(30) },
    },
    getEventsSearch,
  )

  api.get(
    '/events/:id',
    {
      schema: { params: eventParamSchema },
      onRequest: [app.authenticateOptional],
    },
    getEvent,
  )

  api.post(
    '/events',
    { schema: { body: createEventSchema }, onRequest: [app.authenticate] },
    postEvent,
  )

  api.put(
    '/events/:id',
    {
      schema: { params: eventParamSchema, body: updateEventSchema },
      onRequest: [app.authenticate],
    },
    putEvent,
  )

  api.delete(
    '/events/:id',
    { schema: { params: eventParamSchema }, onRequest: [app.authenticate] },
    deleteEventHandler,
  )

  api.post(
    '/events/:id/images',
    {
      schema: { params: eventParamSchema },
      onRequest: [app.authenticate],
      // Upload processa a imagem com sharp inline (CPU/memória); sem teto vira
      // vetor de exaustão.
      config: { rateLimit: rateLimit(20) },
    },
    uploadEventImageHandler,
  )
}
