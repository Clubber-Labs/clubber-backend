import sharp from 'sharp'

export interface ProcessedImage {
  buffer: Buffer
  format: 'webp'
  width: number
  height: number
  size: number
}

async function process(
  buffer: Buffer,
  resize: sharp.ResizeOptions & { width: number; height: number },
  quality: number,
): Promise<ProcessedImage> {
  try {
    const processed = await sharp(buffer)
      .resize(resize)
      .webp({ quality })
      .toBuffer()
    const metadata = await sharp(processed).metadata()

    return {
      buffer: processed,
      format: 'webp',
      width: metadata.width ?? resize.width,
      height: metadata.height ?? resize.height,
      size: processed.length,
    }
  } catch {
    throw { statusCode: 400, message: 'Imagem inválida ou corrompida' }
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
