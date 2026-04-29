import { imageProcessorService } from './image-processor'
import { getStorage } from './storage'

const ALLOWED_MIMETYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

export function assertImageMimetype(mimetype: string) {
  if (!ALLOWED_MIMETYPES.includes(mimetype)) {
    throw {
      statusCode: 400,
      message: 'Formato de imagem não suportado. Use JPEG, PNG, WebP ou GIF',
    }
  }
}

export async function uploadAvatar(buffer: Buffer, userId: string) {
  const processed = await imageProcessorService.processProfileAvatar(buffer)
  return getStorage().upload(
    {
      buffer: processed.buffer,
      filename: 'avatar.webp',
      mimetype: 'image/webp',
    },
    `users/${userId}`,
  )
}

export async function uploadEventImage(buffer: Buffer, eventId: string) {
  const processed = await imageProcessorService.processEventGallery(buffer)
  const result = await getStorage().upload(
    {
      buffer: processed.buffer,
      filename: 'image.webp',
      mimetype: 'image/webp',
    },
    `events/${eventId}`,
  )
  return { ...result, format: processed.format, size: processed.size }
}

export async function deleteUploaded(
  key: string,
  logger: { error: (msg: string) => void },
) {
  try {
    await getStorage().delete(key)
  } catch (err) {
    logger.error(`Falha ao deletar arquivo ${key}: ${(err as Error).message}`)
  }
}
