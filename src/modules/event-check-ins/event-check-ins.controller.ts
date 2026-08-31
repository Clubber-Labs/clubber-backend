import type { FastifyReply, FastifyRequest } from 'fastify'
import type { EventCheckInParam } from './event-check-ins.schema'
import { checkInToEvent } from './event-check-ins.service'

export async function postCheckIn(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { eventId } = request.params as EventCheckInParam
  await checkInToEvent(eventId, request.user.sub)
  request.log.info(
    { userId: request.user.sub, eventId },
    'User checked in to event',
  )
  return reply.status(201).send({ checkedIn: true })
}
