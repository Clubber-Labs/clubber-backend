import { findCommentById } from '../comments/comments.repository'
import { resolveCommentEventId } from '../comments/comments.service'
import { ensureEventAccess } from '../event-invites/event-invites.access'
import { findPostById } from '../posts/posts.repository'
import {
  createCommentReaction,
  createEventReaction,
  createPostReaction,
  deleteCommentReaction,
  deleteEventReaction,
  deletePostReaction,
  findCommentReaction,
  findEventReaction,
  findPostReaction,
} from './reactions.repository'

export async function likeEvent(userId: string, eventId: string) {
  await ensureEventAccess(eventId, userId)
  return createEventReaction(userId, eventId)
}

export async function likePost(userId: string, postId: string) {
  const post = await findPostById(postId)
  if (!post) throw { statusCode: 404, message: 'Post não encontrado' }
  await ensureEventAccess(post.eventId, userId)
  return createPostReaction(userId, postId)
}

export async function likeComment(userId: string, commentId: string) {
  const comment = await findCommentById(commentId)
  if (!comment) throw { statusCode: 404, message: 'Comentário não encontrado' }
  const eventId = await resolveCommentEventId(comment)
  await ensureEventAccess(eventId, userId)
  return createCommentReaction(userId, commentId)
}

export async function unlikeEvent(userId: string, eventId: string) {
  await ensureEventAccess(eventId, userId)
  const reaction = await findEventReaction(userId, eventId)
  if (!reaction) throw { statusCode: 404, message: 'Reação não encontrada' }
  return deleteEventReaction(userId, eventId)
}

export async function unlikePost(userId: string, postId: string) {
  const post = await findPostById(postId)
  if (!post) throw { statusCode: 404, message: 'Post não encontrado' }
  await ensureEventAccess(post.eventId, userId)
  const reaction = await findPostReaction(userId, postId)
  if (!reaction) throw { statusCode: 404, message: 'Reação não encontrada' }
  return deletePostReaction(userId, postId)
}

export async function unlikeComment(userId: string, commentId: string) {
  const comment = await findCommentById(commentId)
  if (!comment) throw { statusCode: 404, message: 'Comentário não encontrado' }
  const eventId = await resolveCommentEventId(comment)
  await ensureEventAccess(eventId, userId)
  const reaction = await findCommentReaction(userId, commentId)
  if (!reaction) throw { statusCode: 404, message: 'Reação não encontrada' }
  return deleteCommentReaction(userId, commentId)
}
