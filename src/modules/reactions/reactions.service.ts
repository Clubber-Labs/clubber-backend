import type { ReactionType } from '@prisma/client'
import { ensureEventAccess } from '../event-invites/event-invites.access'
import { findPostById } from '../posts/posts.repository'
import {
  deleteEventReaction,
  deletePostReaction,
  findEventReaction,
  findPostReaction,
  upsertEventReaction,
  upsertPostReaction,
} from './reactions.repository'

export async function reactToEvent(
  userId: string,
  eventId: string,
  type: ReactionType,
) {
  await ensureEventAccess(eventId, userId)
  return upsertEventReaction(userId, eventId, type)
}

export async function reactToPost(
  userId: string,
  postId: string,
  type: ReactionType,
) {
  const post = await findPostById(postId)
  if (!post) {
    throw { statusCode: 404, message: 'Post não encontrado' }
  }
  await ensureEventAccess(post.eventId, userId)
  return upsertPostReaction(userId, postId, type)
}

export async function removeEventReaction(userId: string, eventId: string) {
  await ensureEventAccess(eventId, userId)
  const reaction = await findEventReaction(userId, eventId)
  if (!reaction) {
    throw { statusCode: 404, message: 'Reação não encontrada' }
  }
  return deleteEventReaction(userId, eventId)
}

export async function removePostReaction(userId: string, postId: string) {
  const post = await findPostById(postId)
  if (!post) {
    throw { statusCode: 404, message: 'Post não encontrado' }
  }
  await ensureEventAccess(post.eventId, userId)
  const reaction = await findPostReaction(userId, postId)
  if (!reaction) {
    throw { statusCode: 404, message: 'Reação não encontrada' }
  }
  return deletePostReaction(userId, postId)
}
