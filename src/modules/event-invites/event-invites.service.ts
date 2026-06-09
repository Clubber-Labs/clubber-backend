import { findEventById } from '../events/events.repository'
import { notifyFromActor } from '../notifications/notifications.service'
import {
  createInvites,
  findEventInvites,
  findFollowerIds,
} from './event-invites.repository'
import type { InviteUsersBody } from './event-invites.schema'

export async function inviteToEvent(
  eventId: string,
  inviterId: string,
  body: InviteUsersBody,
) {
  const event = await findEventById(eventId)
  if (!event) {
    throw { statusCode: 404, message: 'Evento não encontrado' }
  }
  if (event.authorId !== inviterId) {
    throw {
      statusCode: 403,
      message: 'Apenas o autor pode convidar participantes',
    }
  }
  if (event.isPublic) {
    throw {
      statusCode: 400,
      message: 'Eventos públicos não precisam de convites',
    }
  }

  // Se userIds não foi fornecido, convida todos os seguidores
  const targetIds = body?.userIds ?? (await findFollowerIds(inviterId))

  if (targetIds.length === 0) {
    throw { statusCode: 400, message: 'Nenhum usuário para convidar' }
  }

  const invites = await createInvites(eventId, inviterId, targetIds)
  // Fan-out 1→N. notifyFromActor é best-effort (nunca lança) e o self-guard
  // cobre o caso de o autor estar entre os convidados.
  await Promise.all(
    targetIds.map((invitedId) =>
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
    throw { statusCode: 404, message: 'Evento não encontrado' }
  }
  if (event.authorId !== requesterId) {
    throw { statusCode: 403, message: 'Apenas o autor pode ver os convites' }
  }
  return findEventInvites(eventId)
}
