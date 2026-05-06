import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { env } from '../env'
import type {
  FileData,
  IStorageService,
  UploadResult,
} from './storage.interface'

export class LocalStorageService implements IStorageService {
  private readonly uploadDir = env.UPLOADS_DIR

  async upload(file: FileData, folderConfig: string): Promise<UploadResult> {
    const fileId = randomUUID()
    const newFilename = `${fileId}.webp`
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
}
