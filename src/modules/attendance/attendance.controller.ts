import type { FastifyReply, FastifyRequest } from 'fastify'
import type { EventParams } from './attendance.schema'
import { cancelAttendance, confirmAttendance, listAttendances } from './attendance.service'

export async function postAttendance(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { eventId } = request.params as EventParams
    const attendance = await confirmAttendance(request.user.sub, eventId)
    return reply.status(201).send(attendance)
  } catch (err: any) {
    return reply.status(err.statusCode ?? 500).send({ message: err.message })
  }
}

export async function removeAttendance(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { eventId } = request.params as EventParams
    await cancelAttendance(request.user.sub, eventId)
    return reply.status(204).send()
  } catch (err: any) {
    return reply.status(err.statusCode ?? 500).send({ message: err.message })
  }
}

export async function getAttendances(request: FastifyRequest, reply: FastifyReply) {
  const { eventId } = request.params as EventParams
  const attendances = await listAttendances(eventId)
  return reply.send(attendances)
}