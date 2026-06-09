import type { FastifyReply, FastifyRequest } from 'fastify'
import type {
  ListNotificationsQuery,
  RegisterDeviceBody,
} from './notifications.schema'
import {
  getNotifications,
  getUnreadCount,
  markAllRead,
  markRead,
  registerDevice,
  removeDevice,
} from './notifications.service'

export async function getNotificationsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const result = await getNotifications(
    request.user.sub,
    request.query as ListNotificationsQuery,
  )
  return reply.send(result)
}

export async function getUnreadCountHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const count = await getUnreadCount(request.user.sub)
  return reply.send({ count })
}

export async function readNotificationHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as { id: string }
  await markRead(request.user.sub, id)
  return reply.status(204).send()
}

export async function readAllNotificationsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const updated = await markAllRead(request.user.sub)
  return reply.send({ updated })
}

export async function registerDeviceHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { token, platform } = request.body as RegisterDeviceBody
  const device = await registerDevice(request.user.sub, token, platform)
  return reply
    .status(201)
    .send({ id: device.id, token: device.token, platform: device.platform })
}

export async function deleteDeviceHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { token } = request.params as { token: string }
  await removeDevice(request.user.sub, token)
  return reply.status(204).send()
}
