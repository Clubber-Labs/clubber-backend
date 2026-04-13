import type { FastifyInstance } from 'fastify'
import {
  getAttendances,
  postAttendance,
  removeAttendance,
} from './attendance.controller'
import { eventParamsSchema } from './attendance.schema'

export async function attendanceRoutes(app: FastifyInstance) {
  app.post(
    '/events/:eventId/attendances',
    { schema: { params: eventParamsSchema }, onRequest: [app.authenticate] },
    postAttendance,
  )

  app.delete(
    '/events/:eventId/attendances',
    { schema: { params: eventParamsSchema }, onRequest: [app.authenticate] },
    removeAttendance,
  )

  app.get(
    '/events/:eventId/attendances',
    { schema: { params: eventParamsSchema }, onRequest: [app.authenticate] },
    getAttendances,
  )
}
