import type { FastifyReply, FastifyRequest } from 'fastify'
import type { EventInviteParam, InviteUsersBody } from './event-invites.schema'
import { inviteToEvent, listEventInvites } from './event-invites.service'

export async function postInvite(request: FastifyRequest, reply: FastifyReply) {
  const { eventId } = request.params as EventInviteParam
  const result = await inviteToEvent(
    eventId,
    request.user.sub,
    request.body as InviteUsersBody,
  )
  request.log.info(
    { userId: request.user.sub, eventId, invitedCount: result.count },
    'User invited others to event',
  )
  return reply.status(201).send({ invited: result.count })
}

export async function getInvites(request: FastifyRequest, reply: FastifyReply) {
  const { eventId } = request.params as EventInviteParam
  const invites = await listEventInvites(eventId, request.user.sub)
  request.log.info(
    { userId: request.user.sub, eventId },
    'User requested invites for event',
  )
  return reply.send(invites)
}
