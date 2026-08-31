import { AppError } from '../../lib/errors/app-error'
import { deleteUploaded, uploadPostImage } from '../../lib/uploads'
import { ensureEventAccess } from '../event-invites/event-invites.access'
import {
  countPostImages,
  createPost,
  createPostImage,
  deletePost,
  findPostById,
  findPostImageKeys,
  findPostsByEvent,
} from './posts.repository'
import type { CreatePostBody } from './posts.schema'

type Logger = {
  info: (obj: object | string, msg?: string) => void
  error: (obj: object | string, msg?: string) => void
}

// Teto de imagens por post. Eventos não impõem limite (a galeria cresce sem
// freio); aqui fechamos essa lacuna na origem para não acumular blobs pagos.
const MAX_POST_IMAGES = 10

export async function addPost(
  authorId: string,
  eventId: string,
  body: CreatePostBody,
) {
  await ensureEventAccess(eventId, authorId)
  return createPost(authorId, eventId, body.content)
}

export async function addPostImage(
  eventId: string,
  postId: string,
  buffer: Buffer,
  requesterId: string,
  logger: Logger,
) {
  const post = await findPostById(postId)
  if (!post || post.eventId !== eventId) {
    throw new AppError(404, 'POST_NOT_FOUND')
  }
  if (post.authorId !== requesterId) {
    throw new AppError(403, 'NOT_POST_AUTHOR')
  }

  const current = await countPostImages(postId)
  if (current >= MAX_POST_IMAGES) {
    throw new AppError(409, 'POST_IMAGE_LIMIT', undefined, {
      max: MAX_POST_IMAGES,
    })
  }

  const uploaded = await uploadPostImage(buffer, postId)

  try {
    return await createPostImage(postId, {
      url: uploaded.url,
      key: uploaded.key,
      format: uploaded.format,
      size: uploaded.size,
    })
  } catch (err) {
    // Rollback do blob: insert falhou, não deixar asset órfão pago no provider.
    await deleteUploaded(uploaded.key, logger)
    throw err
  }
}

export async function listPostsByEvent(
  eventId: string,
  requesterId: string,
  limit: number,
  cursor?: string,
) {
  await ensureEventAccess(eventId, requesterId)
  const rows = await findPostsByEvent(eventId, requesterId, limit, cursor)
  const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null
  const data = rows.map(({ reactions, ...post }) => ({
    ...post,
    userLiked: reactions.length > 0,
  }))
  return { data, nextCursor }
}

export async function removePost(
  eventId: string,
  postId: string,
  requesterId: string,
  logger: Logger,
) {
  const post = await findPostById(postId)
  if (!post) {
    throw new AppError(404, 'POST_NOT_FOUND')
  }
  if (post.eventId !== eventId) {
    throw new AppError(404, 'POST_NOT_FOUND')
  }
  if (post.authorId !== requesterId) {
    throw new AppError(403, 'NOT_POST_AUTHOR')
  }
  // Limpa os blobs antes de apagar a linha (o cascade remove só as linhas
  // PostImage, não os assets no provider).
  const images = await findPostImageKeys(postId)
  await Promise.all(images.map((img) => deleteUploaded(img.key, logger)))
  return deletePost(postId)
}
