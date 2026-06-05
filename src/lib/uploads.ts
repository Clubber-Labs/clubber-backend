import type { Readable } from 'node:stream'
import { imageProcessorService } from './image-processor'
import { logger } from './logger'
import { getStorage, type StorageResourceType } from './storage'

// GIF fora de propósito: o processador (sharp/webp) achata GIF animado num
// frame estático. Em vez de aceitar e degradar silenciosamente, rejeitamos —
// é mais honesto que entregar um "GIF" parado. Ver 1.5 da auditoria.
const ALLOWED_MIMETYPES = ['image/jpeg', 'image/png', 'image/webp']

// Imagem e áudio compartilham o teto global do multipart (5 MB). Mensagem em PT
// reaproveitada no truncamento do áudio e no error handler global (vídeo tem o
// próprio 413, com limite de 50 MB).
export const FILE_TOO_LARGE_MESSAGE = 'Arquivo acima do limite permitido (5 MB)'

/** Mapeia o kind do attachment para o resource_type do provider (Cloudinary). */
export function resourceTypeForKind(
  kind: 'IMAGE' | 'AUDIO' | 'VIDEO',
): StorageResourceType {
  return kind === 'IMAGE' ? 'image' : 'video'
}

// Áudio AAC em container MP4/M4A — o formato que iOS grava nativamente.
const AUDIO_MIMETYPE_EXTENSIONS: Record<string, string> = {
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'm4a',
}

// Vídeo: formatos aceitos (como o Cloudinary reporta no `format` do asset).
// mp4 (Android), mov (iOS/QuickTime nativo) e webm (gravação web).
const VIDEO_FORMATS = ['mp4', 'mov', 'webm']

// Vídeo sobe DIRETO pro Cloudinary (upload assinado), não passa pelo backend.
// O limite é validado server-side contra o tamanho real reportado pelo provider.
export const MAX_VIDEO_SIZE = 50 * 1024 * 1024

export function assertImageMimetype(mimetype: string) {
  if (!ALLOWED_MIMETYPES.includes(mimetype)) {
    throw {
      statusCode: 400,
      message: 'Formato de imagem não suportado. Use JPEG, PNG ou WebP',
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

export function assertVideoFormat(format: string) {
  if (!VIDEO_FORMATS.includes(format)) {
    throw {
      statusCode: 400,
      message: 'Formato de vídeo não suportado. Use MP4, MOV ou WebM',
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
  // 'authenticated': mídia de chat é privada (acessível só via URL assinada).
  const result = await getStorage().upload(
    {
      buffer: processed.buffer,
      filename: 'image.webp',
      mimetype: 'image/webp',
    },
    `conversations/${conversationId}`,
    'authenticated',
  )
  // width/height vêm do sharp: o cliente reserva o aspect-ratio antes do
  // download (evita layout shift), igual ao vídeo.
  return {
    ...result,
    format: processed.format,
    size: processed.size,
    width: processed.width,
    height: processed.height,
  }
}

export async function uploadMessageAudio(
  file: Readable & { truncated?: boolean },
  conversationId: string,
  mimetype: string,
) {
  // Áudio NÃO passa pelo sharp (imagem). Sobe em STREAM (sem materializar o
  // buffer): o Cloudinary detecta o formato via resource_type 'auto' e devolve o
  // tamanho real em bytes. Evita reter o arquivo inteiro na memória.
  const format = AUDIO_MIMETYPE_EXTENSIONS[mimetype] ?? 'm4a'
  // 'authenticated': mídia de chat é privada (acessível só via URL assinada).
  const result = await getStorage().uploadStream(
    { stream: file, filename: `audio.${format}`, mimetype },
    `conversations/${conversationId}`,
    'authenticated',
  )
  // Streaming não dispara o 413 do multipart sozinho: o busboy apenas trunca no
  // teto e marca `truncated`. Se truncou, o asset parcial já subiu → limpa e 413.
  if (file.truncated) {
    await deleteUploaded(result.key, logger, 'video')
    throw { statusCode: 413, message: FILE_TOO_LARGE_MESSAGE }
  }
  return { ...result, format, size: result.bytes }
}

export async function deleteUploaded(
  key: string,
  logger: { error: (msg: string) => void },
  resourceType: StorageResourceType = 'image',
) {
  try {
    await getStorage().delete(key, resourceType)
  } catch (err) {
    logger.error(`Falha ao deletar arquivo ${key}: ${(err as Error).message}`)
  }
}
