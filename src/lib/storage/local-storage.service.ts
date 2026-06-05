import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { env } from '../env'
import type {
  FileData,
  IStorageService,
  RemoteAsset,
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

  async delete(key: string): Promise<void> {
    await fs.unlink(path.join(this.uploadDir, key))
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
