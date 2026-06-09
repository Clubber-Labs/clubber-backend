import { ensureEventAccess } from '../event-invites/event-invites.access'
import { notifyFromActor } from '../notifications/notifications.service'
import {
  deleteAttendance,
  findAttendanceByUserAndEvent,
  findAttendancesByEvent,
  upsertAttendance,
} from './attendance.repository'

export async function confirmAttendance(
  userId: string,
  eventId: string,
  type: 'INTERESTED' | 'CONFIRMED' | 'NOT_INTERESTED',
) {
  const event = await ensureEventAccess(eventId, userId)
  const attendance = await upsertAttendance(userId, eventId, type)
  // Só presenças positivas notificam o autor (NOT_INTERESTED não é evento social).
  if (type !== 'NOT_INTERESTED') {
    await notifyFromActor({
      recipientId: event.authorId,
      actorId: userId,
      type: 'EVENT_ATTENDANCE',
      eventId,
    })
  }
  return attendance
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
