import { AppError } from '../../lib/errors/app-error'
import {
  deleteUploaded,
  MAX_GALLERY_IMAGES,
  uploadPostImage,
} from '../../lib/uploads'
import { ensureEventAccess } from '../event-invites/event-invites.access'
import {
  countPostImages,
  createPost,
  createPostImage,
  deletePost,
  deletePostImage,
  findPostById,
  findPostImage,
  findPostImageIds,
  findPostImageKeys,
  findPostsByEvent,
  reorderPostImages,
} from './posts.repository'
import type { CreatePostBody } from './posts.schema'

type Logger = {
  info: (obj: object | string, msg?: string) => void
  error: (obj: object | string, msg?: string) => void
}

/**
 * Portão das mutações de galeria: o par (evento, post) é o que autoriza, não o
 * post sozinho — id de outro evento na URL não pode alcançar o post daqui.
 */
async function assertOwnPost(
  eventId: string,
  postId: string,
  requesterId: string,
) {
  const post = await findPostById(postId)
  if (!post || post.eventId !== eventId) {
    throw new AppError(404, 'POST_NOT_FOUND')
  }
  if (post.authorId !== requesterId) {
    throw new AppError(403, 'NOT_POST_AUTHOR')
  }
  return post
}

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
  await assertOwnPost(eventId, postId, requesterId)

  const current = await countPostImages(postId)
  if (current >= MAX_GALLERY_IMAGES) {
    throw new AppError(409, 'POST_IMAGE_LIMIT', undefined, {
      max: MAX_GALLERY_IMAGES,
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

export async function removePostImage(
  eventId: string,
  postId: string,
  imageId: string,
  requesterId: string,
  logger: Logger,
) {
  await assertOwnPost(eventId, postId, requesterId)

  const image = await findPostImage(postId, imageId)
  if (!image) {
    throw new AppError(404, 'POST_IMAGE_NOT_FOUND')
  }

  await deletePostImage(imageId)
  // O cascade só apagaria a linha; o blob no provider é pago e some aqui.
  await deleteUploaded(image.key, logger)
}

export async function reorderPostImagesService(
  eventId: string,
  postId: string,
  order: string[],
  requesterId: string,
) {
  await assertOwnPost(eventId, postId, requesterId)

  // A lista tem que ser um rearranjo exato do conjunto atual: id repetido,
  // faltando ou de outro post deixaria imagem sem posição definida — ou
  // reposicionaria a imagem de um post alheio.
  const current = await findPostImageIds(postId)
  const requested = new Set(order)
  if (
    requested.size !== order.length ||
    requested.size !== current.length ||
    !current.every((imageId) => requested.has(imageId))
  ) {
    throw new AppError(400, 'IMAGE_ORDER_MISMATCH')
  }

  return reorderPostImages(postId, order)
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
  await assertOwnPost(eventId, postId, requesterId)
  // Limpa os blobs antes de apagar a linha (o cascade remove só as linhas
  // PostImage, não os assets no provider).
  const images = await findPostImageKeys(postId)
  await Promise.all(images.map((img) => deleteUploaded(img.key, logger)))
  return deletePost(postId)
}
