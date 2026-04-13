import { ensureEventAccess } from '../event-invites/event-invites.access'
import {
  createAttendance,
  deleteAttendance,
  findAttendanceByUserAndEvent,
  findAttendancesByEvent,
  updateAttendance,
} from './attendance.repository'

export async function confirmAttendance(
  userId: string,
  eventId: string,
  type: 'INTERESTED' | 'CONFIRMED' | 'NOT_INTERESTED',
) {
  await ensureEventAccess(eventId, userId)

  const existing = await findAttendanceByUserAndEvent(userId, eventId)
  if (existing) {
    if (existing.type === type) {
      return existing
    }
    return updateAttendance(userId, eventId, type)
  }

  return createAttendance(userId, eventId, type)
}

export async function cancelAttendance(userId: string, eventId: string) {
  await ensureEventAccess(eventId, userId)

  const existing = await findAttendanceByUserAndEvent(userId, eventId)
  if (!existing) {
    throw { statusCode: 404, message: 'Confirmação de presença não encontrada' }
  }

  return deleteAttendance(userId, eventId)
}

export async function listAttendances(eventId: string, requesterId: string) {
  await ensureEventAccess(eventId, requesterId)
  return findAttendancesByEvent(eventId)
}
