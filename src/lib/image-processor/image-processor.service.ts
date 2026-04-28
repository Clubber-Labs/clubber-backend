import sharp from 'sharp'

export interface ProcessedImage {
  buffer: Buffer
  format: string // usually 'webp'
  width: number
  height: number
  size: number
}

export interface IImageProcessor {
  processProfileAvatar(buffer: Buffer): Promise<ProcessedImage>
  processEventGallery(buffer: Buffer): Promise<ProcessedImage>
}

export class ImageProcessorService implements IImageProcessor {
  async processProfileAvatar(buffer: Buffer): Promise<ProcessedImage> {
    const pipeline = sharp(buffer)
      .resize(300, 300, {
        fit: 'cover',
        position: 'center',
      })
      .webp({ quality: 80 })

    const processedBuffer = await pipeline.toBuffer()
    const metadata = await sharp(processedBuffer).metadata()

    return {
      buffer: processedBuffer,
      format: 'webp',
      width: metadata.width || 300,
      height: metadata.height || 300,
      size: metadata.size || processedBuffer.length,
    }
  }

  async processEventGallery(buffer: Buffer): Promise<ProcessedImage> {
    const pipeline = sharp(buffer)
      .resize(1920, 1080, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 85 })

    const processedBuffer = await pipeline.toBuffer()
    const metadata = await sharp(processedBuffer).metadata()

    return {
      buffer: processedBuffer,
      format: 'webp',
      width: metadata.width || 1920,
      height: metadata.height || 1080,
      size: metadata.size || processedBuffer.length,
    }
  }
}

export const imageProcessorService = new ImageProcessorService()
