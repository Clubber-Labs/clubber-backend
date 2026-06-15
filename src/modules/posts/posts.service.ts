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
    throw { statusCode: 404, message: 'Post não encontrado' }
  }
  if (post.authorId !== requesterId) {
    throw {
      statusCode: 403,
      message: 'Sem permissão para editar este post',
    }
  }

  const current = await countPostImages(postId)
  if (current >= MAX_POST_IMAGES) {
    throw {
      statusCode: 409,
      message: `Limite de ${MAX_POST_IMAGES} imagens por publicação atingido`,
    }
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
  const rows = await findPostsByEvent(eventId, limit, cursor)
  const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null
  return { data: rows, nextCursor }
}

export async function removePost(
  eventId: string,
  postId: string,
  requesterId: string,
  logger: Logger,
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
  // Limpa os blobs antes de apagar a linha (o cascade remove só as linhas
  // PostImage, não os assets no provider).
  const images = await findPostImageKeys(postId)
  await Promise.all(images.map((img) => deleteUploaded(img.key, logger)))
  return deletePost(postId)
}
