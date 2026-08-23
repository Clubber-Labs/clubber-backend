import { AppError } from '../../lib/errors/app-error'
import { canViewAuthorContent } from '../../lib/profile-visibility'
import { findEventAccess } from '../events/events.repository'
import { findInvite } from './event-invites.repository'

type EventAccessInfo = { id: string; isPublic: boolean; authorId: string }

export async function checkEventAccess(
  event: EventAccessInfo,
  requesterId?: string,
): Promise<void> {
  if (event.authorId === requesterId) return

  // Evento público é descobrível e acessível por qualquer um (inclusive
  // anônimo), independente da privacidade do PERFIL do autor. A privacidade
  // do perfil só protege a aba de eventos do próprio perfil (findEventsByAuthor).
  if (event.isPublic) return

  if (!requesterId) {
    throw new AppError(401, 'AUTH_REQUIRED')
  }

  const authorVisible = await canViewAuthorContent(event.authorId, requesterId)
  if (!authorVisible) {
    throw new AppError(403, 'EVENT_ACCESS_DENIED')
  }

  const invite = await findInvite(event.id, requesterId)
  if (!invite) {
    throw new AppError(403, 'EVENT_ACCESS_DENIED')
  }
}

/**
 * Garante que o usuário tem acesso ao evento.
 * Usa um select mínimo — preferir checkEventAccess quando o evento já foi carregado.
 */
export async function ensureEventAccess(eventId: string, requesterId?: string) {
  const event = await findEventAccess(eventId)
  if (!event) {
    throw new AppError(404, 'EVENT_NOT_FOUND')
  }
  await checkEventAccess(event, requesterId)
  return event
}
