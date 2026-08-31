import { AppError } from '../../lib/errors/app-error'
import { checkEventAccess } from '../event-invites/event-invites.access'
import { findEventById } from '../events/events.repository'
import {
  type CheckInUser,
  countCheckIns,
  createCheckIn,
  findTopCheckIns,
  hasCheckedIn,
} from './event-check-ins.repository'

export async function checkInToEvent(eventId: string, userId: string) {
  const event = await findEventById(eventId)
  if (!event) {
    throw new AppError(404, 'EVENT_NOT_FOUND')
  }
  await checkEventAccess(
    event as { id: string; isPublic: boolean; authorId: string },
    userId,
  )

  // Check-in é presença física: só existe enquanto a festa acontece. Fora da
  // janela o app nem mostra o botão, mas tela parada ainda consegue postar.
  if (event.status === 'CANCELED') {
    throw new AppError(400, 'EVENT_CANCELED')
  }
  if (event.status === 'PAST') {
    throw new AppError(400, 'EVENT_ENDED')
  }
  if (event.status !== 'ONGOING') {
    throw new AppError(400, 'EVENT_NOT_STARTED')
  }

  await createCheckIn(eventId, userId)
}

export type CheckInSummary = {
  count: number
  viewerCheckedIn: boolean
  top: { user: CheckInUser }[]
}

/**
 * Resumo das chegadas para o detalhe do evento. Sempre presente (mesmo zerado):
 * é a ausência do campo que faz o app esconder a UI de check-in inteira.
 */
export async function getCheckInSummary(
  eventId: string,
  followingIds: string[],
  viewerId?: string,
): Promise<CheckInSummary> {
  const [count, top, viewerCheckedIn] = await Promise.all([
    countCheckIns(eventId),
    findTopCheckIns(eventId, followingIds),
    viewerId ? hasCheckedIn(eventId, viewerId) : Promise.resolve(false),
  ])
  return { count, viewerCheckedIn, top: top.map((user) => ({ user })) }
}
