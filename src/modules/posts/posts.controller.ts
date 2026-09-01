import type { FastifyReply, FastifyRequest } from 'fastify'
import { AppError } from '../../lib/errors/app-error'
import { assertImageMimetype } from '../../lib/uploads'
import type {
  CreatePostBody,
  EventIdParam,
  PaginationQuery,
  PostImageParam,
  PostParam,
  ReorderPostImagesBody,
} from './posts.schema'
import {
  addPost,
  addPostImage,
  listPostsByEvent,
  removePost,
  removePostImage,
  reorderPostImagesService,
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

export async function deletePostImageHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { eventId, postId, imageId } = request.params as PostImageParam
  await removePostImage(eventId, postId, imageId, request.user.sub, request.log)
  request.log.info(
    { userId: request.user.sub, eventId, postId, imageId },
    'User deleted an image from post',
  )
  return reply.status(204).send()
}

export async function patchPostImagesOrder(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { eventId, postId } = request.params as PostParam
  const { order } = request.body as ReorderPostImagesBody
  const images = await reorderPostImagesService(
    eventId,
    postId,
    order,
    request.user.sub,
  )
  request.log.info(
    { userId: request.user.sub, eventId, postId },
    'User reordered post images',
  )
  return reply.send(images)
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
    throw new AppError(400, 'IMAGE_REQUIRED')
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
