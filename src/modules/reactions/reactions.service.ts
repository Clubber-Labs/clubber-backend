import { findCommentById } from '../comments/comments.repository'
import { resolveCommentEventId } from '../comments/comments.service'
import { ensureEventAccess } from '../event-invites/event-invites.access'
import { notifyFromActor } from '../notifications/notifications.service'
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
  const event = await ensureEventAccess(eventId, userId)
  const reaction = await createEventReaction(userId, eventId)
  await notifyFromActor({
    recipientId: event.authorId,
    actorId: userId,
    type: 'EVENT_REACTION',
    eventId,
  })
  return reaction
}

export async function likePost(userId: string, postId: string) {
  const post = await findPostById(postId)
  if (!post) throw { statusCode: 404, message: 'Post não encontrado' }
  await ensureEventAccess(post.eventId, userId)
  const reaction = await createPostReaction(userId, postId)
  await notifyFromActor({
    recipientId: post.authorId,
    actorId: userId,
    type: 'POST_REACTION',
    // eventId junto: o deep-link do app abre o evento que contém o post.
    eventId: post.eventId,
    postId,
  })
  return reaction
}

export async function likeComment(userId: string, commentId: string) {
  const comment = await findCommentById(commentId)
  if (!comment) throw { statusCode: 404, message: 'Comentário não encontrado' }
  const eventId = await resolveCommentEventId(comment)
  await ensureEventAccess(eventId, userId)
  const reaction = await createCommentReaction(userId, commentId)
  await notifyFromActor({
    recipientId: comment.authorId,
    actorId: userId,
    type: 'COMMENT_REACTION',
    // eventId junto (já resolvido acima): o deep-link abre o evento do comentário.
    eventId,
    commentId,
  })
  return reaction
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
