import path from 'node:path'
import type {
  FileData,
  IStorageService,
  RemoteAsset,
  UploadResult,
  UploadSignature,
} from '../lib/storage'

export class FakeStorageService implements IStorageService {
  uploads: { key: string; url: string; size: number }[] = []
  deleted: string[] = []

  async upload(file: FileData, folderConfig: string): Promise<UploadResult> {
    // Espelha o storage real: extensão derivada do arquivo, não fixa em .webp.
    const ext = path.extname(file.filename) || '.bin'
    const key = `${folderConfig}/${this.uploads.length + 1}${ext}`
    const url = `https://fake.storage/${key}`
    this.uploads.push({ key, url, size: file.buffer.length })
    return { key, url }
  }

  async delete(key: string): Promise<void> {
    this.deleted.push(key)
  }

  signUpload(folder: string, resourceType: 'video'): UploadSignature {
    return {
      signature: 'fake-signature',
      timestamp: 1_749_000_000,
      apiKey: 'fake-api-key',
      cloudName: 'fake-cloud',
      folder,
      resourceType,
    }
  }

  // Simula o Admin API do Cloudinary de forma determinística. Convenções no
  // publicId disparam os caminhos de erro do service:
  // - contém 'missing'   → asset inexistente (null)
  // - contém 'badformat' → formato não permitido
  // - contém 'toobig'    → acima do limite de tamanho
  async getAsset(
    publicId: string,
    _resourceType: 'video',
  ): Promise<RemoteAsset | null> {
    if (publicId.includes('missing')) return null
    const folder = publicId.split('/').slice(0, -1).join('/')
    const format = publicId.includes('badformat') ? 'avi' : 'mp4'
    const bytes = publicId.includes('toobig') ? 60 * 1024 * 1024 : 1_234_567
    return {
      publicId,
      url: `https://fake.storage/${publicId}.${format}`,
      bytes,
      format,
      folder,
      durationMs: 8200,
      width: 1080,
      height: 1920,
    }
  }

  reset() {
    this.uploads = []
    this.deleted = []
  }
}

export const fakeStorage = new FakeStorageService()
