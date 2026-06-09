import type { FastifyReply, FastifyRequest } from 'fastify'
import type { AttendanceBody, EventParams } from './attendance.schema'
import {
  cancelAttendance,
  confirmAttendance,
  listAttendances,
} from './attendance.service'

export async function postAttendance(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { eventId } = request.params as EventParams
  const { type } = request.body as AttendanceBody
  const attendance = await confirmAttendance(request.user.sub, eventId, type)
  request.log.info(
    { userId: request.user.sub, eventId, type },
    'User confirmed attendance for event',
  )
  return reply.status(201).send(attendance)
}

export async function removeAttendance(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { eventId } = request.params as EventParams
  await cancelAttendance(request.user.sub, eventId)
  request.log.info(
    { userId: request.user.sub, eventId },
    'User cancelled attendance for event',
  )
  return reply.status(204).send()
}

export async function getAttendances(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { eventId } = request.params as EventParams
  const attendances = await listAttendances(eventId, request.user.sub)
  request.log.info(
    { userId: request.user.sub, eventId },
    'User requested attendances for event',
  )
  return reply.send(attendances)
}
