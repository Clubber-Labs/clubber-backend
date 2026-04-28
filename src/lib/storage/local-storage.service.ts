import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  FileData,
  IStorageService,
  UploadResult,
} from './storage.interface'

export class LocalStorageService implements IStorageService {
  private readonly uploadDir = path.resolve(__dirname, '../../../uploads')

  constructor() {
    this.ensureDirectoryExists()
  }

  private async ensureDirectoryExists() {
    try {
      await fs.access(this.uploadDir)
    } catch {
      await fs.mkdir(this.uploadDir, { recursive: true })
    }
  }

  async upload(file: FileData, folderConfig: string): Promise<UploadResult> {
    const fileId = randomUUID()
    const newFilename = `${fileId}.webp`

    // key structure: {folderConfig}/{newFilename}
    const key = `${folderConfig}/${newFilename}`
    const targetDir = path.join(this.uploadDir, folderConfig)

    try {
      await fs.access(targetDir)
    } catch {
      await fs.mkdir(targetDir, { recursive: true })
    }

    const filePath = path.join(targetDir, newFilename)
    await fs.writeFile(filePath, file.buffer)

    const port = process.env.PORT || 3333
    // Configura a URL pública (requer @fastify/static servindo a pasta /uploads)
    const url = `http://localhost:${port}/uploads/${key}`

    return { url, key }
  }

  async delete(key: string): Promise<void> {
    try {
      const filePath = path.join(this.uploadDir, key)
      await fs.unlink(filePath)
    } catch (err) {
      console.error(`Local Storage Delete Error (${key}):`, err)
    }
  }
}
