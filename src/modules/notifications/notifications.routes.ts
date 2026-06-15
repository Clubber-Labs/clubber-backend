import type { FastifyInstance } from 'fastify'
import {
  deleteDeviceHandler,
  getNotificationsHandler,
  getUnreadCountHandler,
  readAllNotificationsHandler,
  readNotificationHandler,
  registerDeviceHandler,
} from './notifications.controller'
import {
  deviceTokenParamsSchema,
  listNotificationsQuerySchema,
  notificationIdParamsSchema,
  registerDeviceSchema,
} from './notifications.schema'

export async function notificationsRoutes(app: FastifyInstance) {
  // Central in-app
  app.get(
    '/notifications',
    {
      schema: { querystring: listNotificationsQuerySchema },
      onRequest: [app.authenticate],
    },
    getNotificationsHandler,
  )
  app.get(
    '/notifications/unread-count',
    { onRequest: [app.authenticate] },
    getUnreadCountHandler,
  )
  app.patch(
    '/notifications/:id/read',
    {
      schema: { params: notificationIdParamsSchema },
      onRequest: [app.authenticate],
    },
    readNotificationHandler,
  )
  app.post(
    '/notifications/read-all',
    { onRequest: [app.authenticate] },
    readAllNotificationsHandler,
  )

  // Device tokens (push)
  app.post(
    '/devices',
    {
      schema: { body: registerDeviceSchema },
      onRequest: [app.authenticate],
    },
    registerDeviceHandler,
  )
  app.delete(
    '/devices/:token',
    {
      schema: { params: deviceTokenParamsSchema },
      onRequest: [app.authenticate],
    },
    deleteDeviceHandler,
  )
}
