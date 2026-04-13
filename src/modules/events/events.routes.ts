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
  postEvent,
  putEvent,
} from './events.controller'
import {
  createEventSchema,
  eventParamSchema,
  updateEventSchema,
} from './events.schema'

export async function eventsRoutes(app: FastifyInstance) {
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  const api = app.withTypeProvider<ZodTypeProvider>()

  api.get('/events', getEvents)

  api.get('/events/:id', { schema: { params: eventParamSchema } }, getEvent)

  api.post(
    '/events',
    { schema: { body: createEventSchema }, preHandler: [app.authenticate] },
    postEvent,
  )

  api.put(
    '/events/:id',
    {
      schema: { params: eventParamSchema, body: updateEventSchema },
      preHandler: [app.authenticate],
    },
    putEvent,
  )

  api.delete(
    '/events/:id',
    { schema: { params: eventParamSchema }, preHandler: [app.authenticate] },
    deleteEventHandler,
  )
}
