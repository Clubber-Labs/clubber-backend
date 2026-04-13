import type { FastifyReply, FastifyRequest } from 'fastify'
import type {
  EventReactionParam,
  PostReactionParam,
  ReactionBody,
} from './reactions.schema'
import {
  reactToEvent,
  reactToPost,
  removeEventReaction,
  removePostReaction,
} from './reactions.service'

export async function postEventReaction(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { eventId } = request.params as EventReactionParam
  const { type } = request.body as ReactionBody
  const reaction = await reactToEvent(request.user.sub, eventId, type)
  return reply.status(201).send(reaction)
}

export async function deleteEventReaction(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { eventId } = request.params as EventReactionParam
  await removeEventReaction(request.user.sub, eventId)
  return reply.status(204).send()
}

export async function postPostReaction(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { postId } = request.params as PostReactionParam
  const { type } = request.body as ReactionBody
  const reaction = await reactToPost(request.user.sub, postId, type)
  return reply.status(201).send(reaction)
}

export async function deletePostReaction(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { postId } = request.params as PostReactionParam
  await removePostReaction(request.user.sub, postId)
  return reply.status(204).send()
}
