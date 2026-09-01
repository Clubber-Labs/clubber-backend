import type { FastifyReply, FastifyRequest } from 'fastify'
import { AppError } from '../../lib/errors/app-error'
import { firstIssueField } from '../../lib/errors/zod-issue'
import type { ProcessedImage } from '../../lib/image-processor'
import { assertImageMimetype, processUserPhotoImage } from '../../lib/uploads'
import type { UserIdParam } from '../users/users.schema'
import {
  createUserPhotoFieldsSchema,
  MAX_USER_PHOTO_IMAGES,
  type UserPhotoParam,
  type UserPhotosQuery,
} from './user-photos.schema'
import {
  listUserPhotos,
  publishUserPhoto,
  removeUserPhoto,
} from './user-photos.service'

export async function postUserPhoto(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const fields: Record<string, string> = {}
  const images: ProcessedImage[] = []
  // request.parts(): várias imagens + campos de texto, na ordem em que o app
  // anexou (request.file() devolveria só o primeiro arquivo).
  for await (const part of request.parts()) {
    if (part.type === 'field') {
      if (typeof part.value === 'string') fields[part.fieldname] = part.value
      continue
    }
    // Acima do teto: aborta antes de ler o arquivo — nada subiu ao storage ainda.
    if (images.length >= MAX_USER_PHOTO_IMAGES) {
      throw new AppError(400, 'USER_PHOTO_IMAGE_LIMIT', undefined, {
        max: MAX_USER_PHOTO_IMAGES,
      })
    }
    assertImageMimetype(part.mimetype)
    // Processa conforme chega e retém só o webp: dez originais de até 5 MB em
    // memória por request seria vetor de exaustão.
    images.push(await processUserPhotoImage(await part.toBuffer()))
  }

  const parsed = createUserPhotoFieldsSchema.safeParse(fields)
  if (!parsed.success) {
    throw new AppError(400, 'VALIDATION_ERROR', firstIssueField(parsed.error))
  }

  const photo = await publishUserPhoto(
    request.user.sub,
    parsed.data,
    images,
    request.log,
  )
  request.log.info(
    {
      userId: request.user.sub,
      photoId: photo.id,
      imagesCount: photo.images.length,
    },
    'User published photos to their mural',
  )
  return reply.status(201).send(photo)
}

export async function getUserPhotos(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as UserIdParam
  const { limit, cursor } = request.query as UserPhotosQuery
  const result = await listUserPhotos(id, request.user?.sub, limit, cursor)
  request.log.info(
    { userId: request.user?.sub, targetUserId: id },
    'Requested user mural',
  )
  return reply.send(result)
}

export async function deleteUserPhotoHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { photoId } = request.params as UserPhotoParam
  await removeUserPhoto(request.user.sub, photoId, request.log)
  request.log.info(
    { userId: request.user.sub, photoId },
    'User deleted a mural entry',
  )
  return reply.status(204).send()
}
