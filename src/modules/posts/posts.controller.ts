import type { FastifyReply, FastifyRequest } from 'fastify'
import type {
  CreatePostBody,
  EventIdParam,
  PaginationQuery,
  PostParam,
} from './posts.schema'
import { addPost, listPostsByEvent, removePost } from './posts.service'

export async function postPost(request: FastifyRequest, reply: FastifyReply) {
  const { eventId } = request.params as EventIdParam
  const post = await addPost(
    request.user.sub,
    eventId,
    request.body as CreatePostBody,
  )
  request.log.info(
    { postId: post.id, eventId, userId: request.user.sub },
    'Post created',
  )
  return reply.status(201).send(post)
}

export async function getPosts(request: FastifyRequest, reply: FastifyReply) {
  const { eventId } = request.params as EventIdParam
  const { limit, cursor } = request.query as PaginationQuery
  const result = await listPostsByEvent(
    eventId,
    request.user.sub,
    limit,
    cursor,
  )
  request.log.info(
    { eventId, userId: request.user.sub },
    'Requested posts for event',
  )
  return reply.send(result)
}

export async function deletePost(request: FastifyRequest, reply: FastifyReply) {
  const { eventId, postId } = request.params as PostParam
  await removePost(eventId, postId, request.user.sub)
  request.log.info(
    { eventId, userId: request.user.sub, postId },
    'Deleted post',
  )
  return reply.status(204).send()
}
