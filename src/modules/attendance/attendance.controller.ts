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
  return reply.status(201).send(attendance)
}

export async function removeAttendance(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { eventId } = request.params as EventParams
  await cancelAttendance(request.user.sub, eventId)
  return reply.status(204).send()
}

export async function getAttendances(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { eventId } = request.params as EventParams
  const attendances = await listAttendances(eventId, request.user.sub)
  return reply.send(attendances)
}
