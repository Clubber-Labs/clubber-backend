import { AppError } from '../../lib/errors/app-error'
import { computeEventStatus } from '../../lib/event-lifecycle'
import { checkEventAccess } from '../event-invites/event-invites.access'
import { findEventGate } from '../events/events.repository'
import {
  type CheckInUser,
  countCheckIns,
  createCheckIn,
  findTopCheckIns,
  hasCheckedIn,
} from './event-check-ins.repository'

export async function checkInToEvent(eventId: string, userId: string) {
  const event = await findEventGate(eventId)
  if (!event) {
    throw new AppError(404, 'EVENT_NOT_FOUND')
  }
  await checkEventAccess(event, userId)

  // Check-in é presença física: só existe enquanto a festa acontece. Fora da
  // janela o app nem mostra o botão, mas tela parada ainda consegue postar.
  const status = computeEventStatus(event)
  if (status === 'CANCELED') {
    throw new AppError(400, 'EVENT_CANCELED')
  }
  if (status === 'PAST') {
    throw new AppError(400, 'EVENT_ENDED')
  }
  if (status !== 'ONGOING') {
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
