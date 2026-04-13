import type { FastifyInstance } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import {
  getAttendances,
  postAttendance,
  removeAttendance,
} from './attendance.controller'
import { attendanceBodySchema, eventParamsSchema } from './attendance.schema'

export async function attendanceRoutes(app: FastifyInstance) {
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  const api = app.withTypeProvider<ZodTypeProvider>()

  api.post(
    '/events/:eventId/attendances',
    {
      schema: { params: eventParamsSchema, body: attendanceBodySchema },
      onRequest: [app.authenticate],
    },
    postAttendance,
  )

  api.delete(
    '/events/:eventId/attendances',
    { schema: { params: eventParamsSchema }, onRequest: [app.authenticate] },
    removeAttendance,
  )

  api.get(
    '/events/:eventId/attendances',
    { schema: { params: eventParamsSchema }, onRequest: [app.authenticate] },
    getAttendances,
  )
}
