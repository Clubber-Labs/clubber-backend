import type { FastifyReply, FastifyRequest } from 'fastify'
import { assertImageMimetype } from '../../lib/uploads'
import type {
  CreatePostBody,
  EventIdParam,
  PaginationQuery,
  PostParam,
} from './posts.schema'
import {
  addPost,
  addPostImage,
  listPostsByEvent,
  removePost,
} from './posts.service'

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
  await removePost(eventId, postId, request.user.sub, request.log)
  request.log.info(
    { eventId, userId: request.user.sub, postId },
    'Deleted post',
  )
  return reply.status(204).send()
}

export async function uploadPostImageHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { eventId, postId } = request.params as PostParam
  const data = await request.file()
  if (!data) {
    throw { statusCode: 400, message: 'Nenhuma imagem foi enviada' }
  }
  assertImageMimetype(data.mimetype)

  const buffer = await data.toBuffer()
  const image = await addPostImage(
    eventId,
    postId,
    buffer,
    request.user.sub,
    request.log,
  )
  request.log.info(
    { userId: request.user.sub, eventId, postId, imageId: image.id },
    'User uploaded an image for post',
  )
  return reply.status(201).send(image)
}
