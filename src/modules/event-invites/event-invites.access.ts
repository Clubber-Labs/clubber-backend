import { findEventById } from '../events/events.repository'
import { findInvite } from './event-invites.repository'

/**
 * Garante que o usuário tem acesso ao evento.
 * Eventos públicos: qualquer usuário autenticado.
 * Eventos privados: apenas o autor ou convidados.
 */
export async function ensureEventAccess(eventId: string, requesterId: string) {
  const event = await findEventById(eventId)
  if (!event) {
    throw { statusCode: 404, message: 'Evento não encontrado' }
  }

  if (event.isPublic) {
    return event
  }

  if (event.authorId === requesterId) {
    return event
  }

  const invite = await findInvite(eventId, requesterId)
  if (!invite) {
    throw { statusCode: 403, message: 'Você não tem acesso a este evento' }
  }

  return event
}
