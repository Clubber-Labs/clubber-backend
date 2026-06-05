import { imageProcessorService } from './image-processor'
import { getStorage } from './storage'

const ALLOWED_MIMETYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

// Áudio AAC em container MP4/M4A — o formato que iOS grava nativamente.
const AUDIO_MIMETYPE_EXTENSIONS: Record<string, string> = {
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'm4a',
}

export function assertImageMimetype(mimetype: string) {
  if (!ALLOWED_MIMETYPES.includes(mimetype)) {
    throw {
      statusCode: 400,
      message: 'Formato de imagem não suportado. Use JPEG, PNG, WebP ou GIF',
    }
  }
}

export function assertAudioMimetype(mimetype: string) {
  if (!(mimetype in AUDIO_MIMETYPE_EXTENSIONS)) {
    throw {
      statusCode: 400,
      message: 'Formato de áudio não suportado. Use M4A/AAC',
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

export async function uploadMessageImage(
  buffer: Buffer,
  conversationId: string,
) {
  const processed = await imageProcessorService.processEventGallery(buffer)
  const result = await getStorage().upload(
    {
      buffer: processed.buffer,
      filename: 'image.webp',
      mimetype: 'image/webp',
    },
    `conversations/${conversationId}`,
  )
  return { ...result, format: processed.format, size: processed.size }
}

export async function uploadMessageAudio(
  buffer: Buffer,
  conversationId: string,
  mimetype: string,
) {
  // Áudio NÃO passa pelo sharp (que é só pra imagem): sobe o binário cru. O
  // Cloudinary detecta o formato via resource_type 'auto'; o size é o do buffer.
  const format = AUDIO_MIMETYPE_EXTENSIONS[mimetype] ?? 'm4a'
  const result = await getStorage().upload(
    { buffer, filename: `audio.${format}`, mimetype },
    `conversations/${conversationId}`,
  )
  return { ...result, format, size: buffer.length }
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
