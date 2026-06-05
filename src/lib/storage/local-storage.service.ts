import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { env } from '../env'
import type {
  FileData,
  IStorageService,
  RemoteAsset,
  StreamData,
  StreamUploadResult,
  UploadResult,
  UploadSignature,
} from './storage.interface'

export class LocalStorageService implements IStorageService {
  private readonly uploadDir = env.UPLOADS_DIR

  async upload(file: FileData, folderConfig: string): Promise<UploadResult> {
    const fileId = randomUUID()
    // Extensão vem do arquivo enviado (imagem .webp, áudio .m4a…), não fixa.
    const ext = path.extname(file.filename) || '.bin'
    const newFilename = `${fileId}${ext}`
    const key = `${folderConfig}/${newFilename}`
    const targetDir = path.join(this.uploadDir, folderConfig)

    await fs.mkdir(targetDir, { recursive: true })
    await fs.writeFile(path.join(targetDir, newFilename), file.buffer)

    return {
      url: `${env.PUBLIC_URL}/uploads/${key}`,
      key,
    }
  }

  async uploadStream(
    file: StreamData,
    folderConfig: string,
  ): Promise<StreamUploadResult> {
    const fileId = randomUUID()
    const ext = path.extname(file.filename) || '.bin'
    const newFilename = `${fileId}${ext}`
    const key = `${folderConfig}/${newFilename}`
    const targetDir = path.join(this.uploadDir, folderConfig)
    await fs.mkdir(targetDir, { recursive: true })

    const target = path.join(targetDir, newFilename)
    let bytes = 0
    file.stream.on('data', (chunk: Buffer) => {
      bytes += chunk.length
    })
    // pipeline propaga erro/backpressure e fecha o arquivo ao final.
    await pipeline(file.stream, createWriteStream(target))

    return { url: `${env.PUBLIC_URL}/uploads/${key}`, key, bytes }
  }

  // resourceType não se aplica ao filesystem local — a key já é o caminho.
  async delete(key: string): Promise<void> {
    await fs.unlink(path.join(this.uploadDir, key))
  }

  // Sem assinatura no filesystem local: reconstrói a URL pública a partir do
  // key (que já é o caminho com extensão). deliveryType/opts são irrelevantes.
  signedUrl(key: string): string {
    return `${env.PUBLIC_URL}/uploads/${key}`
  }

  // Upload direto assinado depende do provider externo (Cloudinary). No storage
  // local não há para onde o cliente subir direto nem Admin API para verificar.
  signUpload(): UploadSignature {
    throw {
      statusCode: 501,
      message: 'Upload direto de vídeo requer o storage Cloudinary',
    }
  }

  async getAsset(): Promise<RemoteAsset | null> {
    throw {
      statusCode: 501,
      message: 'Upload direto de vídeo requer o storage Cloudinary',
    }
  }
}
