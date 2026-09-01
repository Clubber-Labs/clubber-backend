import { randomUUID } from 'node:crypto'
import { AppError } from '../../lib/errors/app-error'
import type { ProcessedImage } from '../../lib/image-processor'
import { deleteUploaded, uploadUserPhotoImage } from '../../lib/uploads'
import { isBlockedEitherWay } from '../blocks/blocks.repository'
import { hasEventAccess } from '../event-invites/event-invites.access'
import { findFollow } from '../follows/follows.repository'
import {
  createUserPhoto,
  deleteUserPhoto,
  findEventForPhotoLink,
  findMuralOwner,
  findUserPhotoForDeletion,
  findUserPhotos,
  type UserPhotoRow,
} from './user-photos.repository'
import {
  type CreateUserPhotoFields,
  MAX_USER_PHOTO_IMAGES,
} from './user-photos.schema'

type Logger = {
  error: (obj: object | string, msg?: string) => void
}

type UploadedImage = Awaited<ReturnType<typeof uploadUserPhotoImage>>

export async function publishUserPhoto(
  userId: string,
  fields: CreateUserPhotoFields,
  images: ProcessedImage[],
  logger: Logger,
) {
  if (images.length === 0) {
    throw new AppError(400, 'IMAGE_REQUIRED')
  }
  if (images.length > MAX_USER_PHOTO_IMAGES) {
    throw new AppError(400, 'USER_PHOTO_IMAGE_LIMIT', undefined, {
      max: MAX_USER_PHOTO_IMAGES,
    })
  }
  if (fields.eventId) {
    await ensureAttendedEvent(fields.eventId, userId)
  }

  // O id nasce aqui para os blobs já subirem na pasta da entrada.
  const photoId = randomUUID()
  const uploaded = await uploadAll(images, userId, photoId, logger)
  try {
    const photo = await createUserPhoto({
      id: photoId,
      userId,
      caption: fields.caption ?? null,
      eventId: fields.eventId ?? null,
      images: uploaded,
    })
    return toApiUserPhoto(photo, new Set())
  } catch (err) {
    // Rollback dos blobs: insert falhou, não deixar asset órfão pago no provider.
    await deleteImageBlobs(uploaded, logger)
    throw err
  }
}

async function uploadAll(
  images: ProcessedImage[],
  userId: string,
  photoId: string,
  logger: Logger,
): Promise<UploadedImage[]> {
  const uploaded: UploadedImage[] = []
  for (const image of images) {
    try {
      uploaded.push(await uploadUserPhotoImage(image, userId, photoId))
    } catch (err) {
      await deleteImageBlobs(uploaded, logger)
      throw err
    }
  }
  return uploaded
}

async function deleteImageBlobs(images: { key: string }[], logger: Logger) {
  await Promise.all(images.map((image) => deleteUploaded(image.key, logger)))
}

async function ensureAttendedEvent(eventId: string, userId: string) {
  const event = await findEventForPhotoLink(eventId, userId)
  if (!event) {
    throw new AppError(404, 'EVENT_NOT_FOUND')
  }
  // "Compareceu" = criou o evento, confirmou presença ou fez check-in.
  // INTERESTED é curiosidade, não presença — não vincula.
  const attended =
    event.authorId === userId ||
    event.attendances.length > 0 ||
    event.checkIns.length > 0
  if (!attended) {
    throw new AppError(400, 'EVENT_NOT_ATTENDED')
  }
}

export async function listUserPhotos(
  ownerId: string,
  viewerId: string | undefined,
  limit: number,
  cursor?: string,
) {
  const owner = await findMuralOwner(ownerId)
  if (!owner) {
    throw new AppError(404, 'USER_NOT_FOUND')
  }

  const isSelf = viewerId === ownerId
  if (!isSelf) {
    // Mesma régua das listas de seguidores: perfil privado só abre para follow aceito.
    if (owner.isPrivate) {
      const follow = viewerId ? await findFollow(viewerId, ownerId) : null
      if (follow?.status !== 'ACCEPTED') {
        throw new AppError(403, 'PRIVATE_PROFILE')
      }
    }
    // Bloqueio em qualquer direção: mural vazio, sem denunciar o bloqueio — a
    // vitrine de eventos do perfil faz o mesmo (filtra, não erra).
    if (viewerId && (await isBlockedEitherWay(ownerId, viewerId))) {
      return { data: [], nextCursor: null }
    }
  }

  const rows = await findUserPhotos(ownerId, limit, cursor)
  const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null
  const hiddenEventIds = isSelf
    ? new Set<string>()
    : await findInaccessibleEventIds(rows, viewerId)
  return {
    data: rows.map((row) => toApiUserPhoto(row, hiddenEventIds)),
    nextCursor,
  }
}

/**
 * Eventos privados do lote que o viewer não pode abrir: o vínculo some da
 * resposta para ele (nem o título vaza). Um check por evento distinto, não
 * por foto — a mesma régua do GET /events/:id (hasEventAccess).
 */
async function findInaccessibleEventIds(
  rows: UserPhotoRow[],
  viewerId?: string,
) {
  const privateEvents = new Map<string, NonNullable<UserPhotoRow['event']>>()
  for (const row of rows) {
    if (row.event && !row.event.isPublic) {
      privateEvents.set(row.event.id, row.event)
    }
  }
  const hidden = new Set<string>()
  await Promise.all(
    [...privateEvents.values()].map(async (event) => {
      if (!(await hasEventAccess(event, viewerId))) hidden.add(event.id)
    }),
  )
  return hidden
}

function toApiUserPhoto(row: UserPhotoRow, hiddenEventIds: Set<string>) {
  const { event, ...rest } = row
  return {
    ...rest,
    event:
      event && !hiddenEventIds.has(event.id)
        ? { id: event.id, title: event.title }
        : null,
  }
}

export async function removeUserPhoto(
  userId: string,
  photoId: string,
  logger: Logger,
) {
  const photo = await findUserPhotoForDeletion(photoId)
  if (!photo) {
    throw new AppError(404, 'USER_PHOTO_NOT_FOUND')
  }
  if (photo.userId !== userId) {
    throw new AppError(403, 'NOT_USER_PHOTO_AUTHOR')
  }
  // Blobs antes da linha: o cascade remove só as linhas, não os assets no provider.
  await deleteImageBlobs(photo.images, logger)
  await deleteUserPhoto(photoId)
}
