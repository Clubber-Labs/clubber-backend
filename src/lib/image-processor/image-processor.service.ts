import sharp, { type ResizeOptions } from 'sharp'
import { AppError } from '../errors/app-error'

export interface ProcessedImage {
  buffer: Buffer
  format: 'webp'
  width: number
  height: number
  size: number
}

async function process(
  buffer: Buffer,
  resize: ResizeOptions & { width: number; height: number },
  quality: number,
): Promise<ProcessedImage> {
  try {
    // Câmera de celular grava os pixels na orientação do sensor e diz o resto na
    // tag EXIF Orientation. O WebP de saída não carrega essa tag, então sem
    // aplicá-la aqui a foto de retrato chega deitada — e o recorte do avatar
    // sairia do lado errado da imagem. Vem antes do resize: é o que faz o
    // 1920x1080 valer sobre as dimensões já corrigidas.
    const { data, info } = await sharp(buffer)
      .autoOrient()
      .resize(resize)
      .webp({ quality })
      .toBuffer({ resolveWithObject: true })

    return {
      buffer: data,
      format: 'webp',
      width: info.width ?? resize.width,
      height: info.height ?? resize.height,
      size: info.size ?? data.length,
    }
  } catch {
    throw new AppError(400, 'INVALID_IMAGE')
  }
}

export const imageProcessorService = {
  processProfileAvatar(buffer: Buffer) {
    return process(
      buffer,
      { width: 300, height: 300, fit: 'cover', position: 'center' },
      80,
    )
  },
  processEventGallery(buffer: Buffer) {
    return process(
      buffer,
      { width: 1920, height: 1080, fit: 'inside', withoutEnlargement: true },
      85,
    )
  },
}
