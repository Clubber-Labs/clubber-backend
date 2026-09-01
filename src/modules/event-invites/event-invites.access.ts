import { AppError } from '../../lib/errors/app-error'
import { isBlockedEitherWay } from '../blocks/blocks.repository'
import { findEventAccess } from '../events/events.repository'
import { findInvite } from './event-invites.repository'

type EventAccessInfo = { id: string; isPublic: boolean; authorId: string }

/**
 * Régua única de acesso ao evento, em forma de booleano — para quem só
 * precisa decidir se MOSTRA algo (ex.: o vínculo de uma foto do mural), sem
 * transformar a negativa em erro HTTP.
 */
export async function hasEventAccess(
  event: EventAccessInfo,
  requesterId?: string,
): Promise<boolean> {
  if (event.authorId === requesterId) return true

  // Evento público é descobrível e acessível por qualquer um (inclusive
  // anônimo), independente da privacidade do PERFIL do autor. A privacidade
  // do perfil só protege a aba de eventos do próprio perfil (findEventsByAuthor).
  if (event.isPublic) return true

  if (!requesterId) return false

  // O convite é concessão explícita do autor e vale por si — inclusive para
  // quem não segue um autor privado (link compartilhável). Bloqueio em
  // qualquer direção continua negando, mesmo com convite.
  if (await isBlockedEitherWay(event.authorId, requesterId)) return false

  const invite = await findInvite(event.id, requesterId)
  return invite !== null
}

export async function checkEventAccess(
  event: EventAccessInfo,
  requesterId?: string,
): Promise<void> {
  if (event.authorId === requesterId || event.isPublic) return

  if (!requesterId) {
    throw new AppError(401, 'AUTH_REQUIRED')
  }

  if (!(await hasEventAccess(event, requesterId))) {
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
