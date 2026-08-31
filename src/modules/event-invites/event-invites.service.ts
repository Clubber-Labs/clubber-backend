import { AppError } from '../../lib/errors/app-error'
import { findEventById } from '../events/events.repository'
import { notifyFromActor } from '../notifications/notifications.service'
import {
  createInvites,
  findEventInvites,
  findFollowerIds,
  findInvitableIds,
  findInvitedIdsIn,
} from './event-invites.repository'
import type { InviteUsersBody } from './event-invites.schema'

export async function inviteToEvent(
  eventId: string,
  inviterId: string,
  body: InviteUsersBody,
) {
  const event = await findEventById(eventId)
  if (!event) {
    throw new AppError(404, 'EVENT_NOT_FOUND')
  }
  // Privado: só o autor convida (o convite concede acesso). Público: qualquer
  // autenticado convida — é divulgação, o acesso todo mundo já tem.
  if (!event.isPublic && event.authorId !== inviterId) {
    throw new AppError(403, 'NOT_EVENT_AUTHOR')
  }

  // Mesma régua de janela do link compartilhável: evento morto não recebe
  // convite nem dispara push. ONGOING ainda convida ("vem agora").
  if (event.status === 'CANCELED') {
    throw new AppError(400, 'EVENT_CANCELED')
  }
  if (event.status === 'PAST') {
    throw new AppError(400, 'EVENT_ENDED')
  }

  // Sem lista (com ou sem `all`), convida todos os seguidores DO CONVIDADOR
  const selected = body?.userIds ?? body?.invitedIds
  const requested = selected ?? (await findFollowerIds(inviterId))
  let targetIds = requested.filter(
    (id) => id !== inviterId && id !== event.authorId,
  )

  // Em público o convidador pode ser um estranho para o convidado: perfil
  // privado só entra com follow mútuo (proteção anti-spam do convidado).
  if (event.isPublic) {
    targetIds = await findInvitableIds(inviterId, targetIds)
  }

  if (targetIds.length === 0) {
    throw new AppError(400, 'NO_USERS_TO_INVITE')
  }

  // Notifica só convites NOVOS: com vários convidadores, o dedupe da
  // notificação (que inclui o actor) não segura o re-push de um segundo
  // convidador para quem já foi convidado.
  const alreadyInvited = await findInvitedIdsIn(eventId, targetIds)
  const newIds = targetIds.filter((id) => !alreadyInvited.has(id))

  const invites = await createInvites(eventId, inviterId, newIds)
  // Fan-out 1→N. notifyFromActor é best-effort (nunca lança).
  await Promise.all(
    newIds.map((invitedId) =>
      notifyFromActor({
        recipientId: invitedId,
        actorId: inviterId,
        type: 'EVENT_INVITE',
        eventId,
      }),
    ),
  )
  return invites
}

export async function listEventInvites(eventId: string, requesterId: string) {
  const event = await findEventById(eventId)
  if (!event) {
    throw new AppError(404, 'EVENT_NOT_FOUND')
  }
  if (event.authorId !== requesterId) {
    throw new AppError(403, 'NOT_EVENT_AUTHOR')
  }
  return findEventInvites(eventId)
}
