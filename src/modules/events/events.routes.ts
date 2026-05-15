import type { FastifyInstance } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import {
  deleteEventHandler,
  getEvent,
  getEvents,
  getEventsMap,
  postEvent,
  putEvent,
  uploadEventImageHandler,
} from './events.controller'
import {
  createEventSchema,
  eventParamSchema,
  listEventsQuerySchema,
  mapEventsQuerySchema,
  updateEventSchema,
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
    },
    getEvents,
  )

  api.get(
    '/events/map',
    {
      schema: { querystring: mapEventsQuerySchema },
      onRequest: [app.authenticateOptional],
    },
    getEventsMap,
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
    { schema: { params: eventParamSchema }, onRequest: [app.authenticate] },
    uploadEventImageHandler,
  )
}
