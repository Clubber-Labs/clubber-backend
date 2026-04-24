import { ensureEventAccess } from '../event-invites/event-invites.access'
import {
  createPost,
  deletePost,
  findPostById,
  findPostsByEvent,
} from './posts.repository'
import type { CreatePostBody } from './posts.schema'

export async function addPost(
  authorId: string,
  eventId: string,
  body: CreatePostBody,
) {
  await ensureEventAccess(eventId, authorId)
  return createPost(authorId, eventId, body.content)
}

export async function listPostsByEvent(
  eventId: string,
  requesterId: string,
  limit: number,
  cursor?: string,
) {
  await ensureEventAccess(eventId, requesterId)
  const rows = await findPostsByEvent(eventId, limit, cursor)
  const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null
  return { data: rows, nextCursor }
}

export async function removePost(
  eventId: string,
  postId: string,
  requesterId: string,
) {
  const post = await findPostById(postId)
  if (!post) {
    throw { statusCode: 404, message: 'Post não encontrado' }
  }
  if (post.eventId !== eventId) {
    throw { statusCode: 404, message: 'Post não encontrado neste evento' }
  }
  if (post.authorId !== requesterId) {
    throw { statusCode: 403, message: 'Sem permissão para deletar este post' }
  }
  return deletePost(postId)
}
