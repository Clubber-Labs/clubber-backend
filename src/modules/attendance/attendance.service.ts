import {
  createAttendance,
  deleteAttendance,
  findAttendanceByUserAndEvent,
  findAttendancesByEvent,
} from './attendance.repository'

export async function confirmAttendance(userId: string, eventId: string) {
  const existing = await findAttendanceByUserAndEvent(userId, eventId)

  if (existing) {
    throw { statusCode: 409, message: 'Presença já confirmada neste evento' }
  }

  return createAttendance(userId, eventId)
}

export async function cancelAttendance(userId: string, eventId: string) {
  const existing = await findAttendanceByUserAndEvent(userId, eventId)

  if (!existing) {
    throw { statusCode: 404, message: 'Confirmação de presença não encontrada' }
  }

  return deleteAttendance(userId, eventId)
}

export async function listAttendances(eventId: string) {
  return findAttendancesByEvent(eventId)
}
