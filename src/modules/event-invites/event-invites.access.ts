import { findEventAccess } from '../events/events.repository'
import { findInvite } from './event-invites.repository'

type EventAccessInfo = { id: string; isPublic: boolean; authorId: string }

export async function checkEventAccess(
  event: EventAccessInfo,
  requesterId?: string,
): Promise<void> {
  if (event.isPublic) return

  if (!requesterId) {
    throw {
      statusCode: 401,
      message: 'Autenticação necessária para acessar este evento',
    }
  }

  if (event.authorId === requesterId) return

  const invite = await findInvite(event.id, requesterId)
  if (!invite) {
    throw { statusCode: 403, message: 'Você não tem acesso a este evento' }
  }
}

/**
 * Garante que o usuário tem acesso ao evento.
 * Usa um select mínimo — preferir checkEventAccess quando o evento já foi carregado.
 */
export async function ensureEventAccess(eventId: string, requesterId?: string) {
  const event = await findEventAccess(eventId)
  if (!event) {
    throw { statusCode: 404, message: 'Evento não encontrado' }
  }
  await checkEventAccess(event, requesterId)
  return event
}
