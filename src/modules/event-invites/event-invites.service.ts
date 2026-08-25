import { AppError } from '../../lib/errors/app-error'
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
    throw new AppError(404, 'EVENT_NOT_FOUND')
  }
  if (event.authorId !== inviterId) {
    throw new AppError(403, 'NOT_EVENT_AUTHOR')
  }

  // Se userIds não foi fornecido, convida todos os seguidores
  const targetIds = body?.userIds ?? (await findFollowerIds(inviterId))

  if (targetIds.length === 0) {
    throw new AppError(400, 'NO_USERS_TO_INVITE')
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
    throw new AppError(404, 'EVENT_NOT_FOUND')
  }
  if (event.authorId !== requesterId) {
    throw new AppError(403, 'NOT_EVENT_AUTHOR')
  }
  return findEventInvites(eventId)
}
