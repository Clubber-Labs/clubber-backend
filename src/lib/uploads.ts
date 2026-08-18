import type { Readable } from 'node:stream'
import { AppError } from './errors/app-error'
import { imageProcessorService } from './image-processor'
import { logger } from './logger'
import { getStorage, type StorageDeliveryType } from './storage'

// GIF fora de propósito: o processador (sharp/webp) achata GIF animado num
// frame estático. Em vez de aceitar e degradar silenciosamente, rejeitamos —
// é mais honesto que entregar um "GIF" parado. Ver 1.5 da auditoria.
const ALLOWED_MIMETYPES = ['image/jpeg', 'image/png', 'image/webp']

// Imagem e áudio compartilham o teto global do multipart (5 MB). Mensagem em PT
// reaproveitada no truncamento do áudio e no error handler global (vídeo tem o
// próprio 413, com limite de 50 MB).

// Áudio AAC em container MP4/M4A — o formato que iOS grava nativamente.
const AUDIO_MIMETYPE_EXTENSIONS: Record<string, string> = {
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'm4a',
}

// Vídeo: formatos aceitos, como detectado pelos magic bytes (sniffVideoFormat).
// mp4 (Android), mov (iOS/QuickTime nativo) e webm (gravação web).
const VIDEO_FORMATS = ['mp4', 'mov', 'webm']

// Vídeo sobe DIRETO pro R2 (upload assinado), não passa pelo backend. O
// limite é validado server-side contra o tamanho real reportado pelo provider.
export const MAX_VIDEO_SIZE = 50 * 1024 * 1024

export function assertImageMimetype(mimetype: string) {
  if (!ALLOWED_MIMETYPES.includes(mimetype)) {
    throw new AppError(400, 'UNSUPPORTED_IMAGE_FORMAT')
  }
}

export function assertAudioMimetype(mimetype: string) {
  if (!(mimetype in AUDIO_MIMETYPE_EXTENSIONS)) {
    throw new AppError(400, 'UNSUPPORTED_AUDIO_FORMAT')
  }
}

export function assertVideoFormat(format: string) {
  if (!VIDEO_FORMATS.includes(format)) {
    throw new AppError(400, 'UNSUPPORTED_VIDEO_FORMAT')
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

export async function uploadPostImage(buffer: Buffer, postId: string) {
  const processed = await imageProcessorService.processEventGallery(buffer)
  const result = await getStorage().upload(
    {
      buffer: processed.buffer,
      filename: 'image.webp',
      mimetype: 'image/webp',
    },
    `posts/${postId}`,
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
  // buffer): o driver detecta o formato por magic bytes e devolve o tamanho
  // real em bytes. Evita reter o arquivo inteiro na memória.
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
    await deleteChatMedia(result.key, logger)
    throw new AppError(413, 'FILE_TOO_LARGE', undefined, { maxMb: 5 })
  }
  // Validação por CONTEÚDO (não pelo Content-Type do cliente): o driver
  // detecta o tipo real por magic bytes. Áudio/vídeo são 'video'; 'raw'/
  // 'image' = não é áudio. Fecha a lacuna de confiar no mimetype enviado
  // (imagem já é validada pelo sharp; vídeo, pelo formato do getAsset).
  if (result.detectedResourceType !== 'video') {
    await deleteChatMedia(result.key, logger)
    throw new AppError(400, 'INVALID_AUDIO_CONTENT')
  }
  return { ...result, format, size: result.bytes }
}

export async function deleteUploaded(
  key: string,
  logger: { error: (msg: string) => void },
  deliveryType: StorageDeliveryType = 'upload',
) {
  try {
    await getStorage().delete(key, deliveryType)
  } catch (err) {
    logger.error(`Falha ao deletar arquivo ${key}: ${(err as Error).message}`)
  }
}

// Mídia de CHAT é sempre 'authenticated' (privada). Helper dedicado para os
// callers de chat não dependerem de LEMBRAR o deliveryType: esquecer cairia no
// default 'upload' e o delete não apagaria o asset privado (órfão pago).
export async function deleteChatMedia(
  key: string,
  logger: { error: (msg: string) => void },
) {
  await deleteUploaded(key, logger, 'authenticated')
}
