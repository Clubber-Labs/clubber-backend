import { cache } from '../../lib/cache'
import { ensureEventAccess } from '../event-invites/event-invites.access'
import { findPostById } from '../posts/posts.repository'
import {
  createComment,
  deleteComment,
  findCommentById,
  findCommentsByEvent,
  findCommentsByPost,
} from './comments.repository'
import type { CreateCommentBody } from './comments.schema'

export async function addCommentToEvent(
  authorId: string,
  eventId: string,
  body: CreateCommentBody,
) {
  const event = await ensureEventAccess(eventId, authorId)
  const comment = await createComment(authorId, body.content, { eventId })
  if (event.isPublic) {
    await cache.invalidate('events:public:*')
  }
  return comment
}

export async function addCommentToPost(
  authorId: string,
  postId: string,
  body: CreateCommentBody,
) {
  const post = await findPostById(postId)
  if (!post) {
    throw { statusCode: 404, message: 'Post não encontrado' }
  }
  await ensureEventAccess(post.eventId, authorId)
  return createComment(authorId, body.content, { postId })
}

export async function listEventComments(
  eventId: string,
  requesterId: string,
  limit: number,
  cursor?: string,
) {
  await ensureEventAccess(eventId, requesterId)
  const rows = await findCommentsByEvent(eventId, limit, cursor)
  const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null
  return { data: rows, nextCursor }
}

export async function listPostComments(
  postId: string,
  requesterId: string,
  limit: number,
  cursor?: string,
) {
  const post = await findPostById(postId)
  if (!post) {
    throw { statusCode: 404, message: 'Post não encontrado' }
  }
  await ensureEventAccess(post.eventId, requesterId)
  const rows = await findCommentsByPost(postId, limit, cursor)
  const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null
  return { data: rows, nextCursor }
}

export async function removeComment(
  commentId: string,
  requesterId: string,
  scopeId: string,
) {
  const comment = await findCommentById(commentId)
  if (!comment) {
    throw { statusCode: 404, message: 'Comentário não encontrado' }
  }

  const belongsToScope =
    comment.eventId === scopeId || comment.postId === scopeId
  if (!belongsToScope) {
    throw { statusCode: 404, message: 'Comentário não encontrado neste escopo' }
  }

  let eventId = comment.eventId
  if (!eventId && comment.postId) {
    const post = await findPostById(comment.postId)
    eventId = post?.eventId ?? null
  }
  if (!eventId) {
    throw { statusCode: 404, message: 'Comentário sem evento associado' }
  }
  const event = await ensureEventAccess(eventId, requesterId)

  if (comment.authorId !== requesterId) {
    throw {
      statusCode: 403,
      message: 'Sem permissão para deletar este comentário',
    }
  }

  const result = await deleteComment(commentId)
  if (comment.eventId && event.isPublic) {
    await cache.invalidate('events:public:*')
  }
  return result
}
