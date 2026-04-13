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
  return reply.status(201).send({ invited: result.count })
}

export async function getInvites(request: FastifyRequest, reply: FastifyReply) {
  const { eventId } = request.params as EventInviteParam
  const invites = await listEventInvites(eventId, request.user.sub)
  return reply.send(invites)
}
