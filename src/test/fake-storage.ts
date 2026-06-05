import path from 'node:path'
import type {
  FileData,
  IStorageService,
  RemoteAsset,
  StorageDeliveryType,
  StorageResourceType,
  StreamData,
  StreamUploadResult,
  UploadResult,
  UploadSignature,
} from '../lib/storage'

export class FakeStorageService implements IStorageService {
  uploads: {
    key: string
    url: string
    size: number
    deliveryType: StorageDeliveryType
  }[] = []
  deleted: string[] = []
  deletedResources: { key: string; resourceType: StorageResourceType }[] = []
  // Seam de teste: força o próximo uploadStream a reportar um tamanho acima do
  // int4 do Postgres (> 2.147B). O insert do attachment estoura ("value out of
  // range for type integer") → permite testar o delete compensatório sem mockar
  // o Prisma (a falha vem do banco real).
  forceOversizeBytes = false

  private nextKey(folderConfig: string, ext: string): string {
    return `${folderConfig}/${this.uploads.length + 1}${ext}`
  }

  async upload(
    file: FileData,
    folderConfig: string,
    deliveryType: StorageDeliveryType = 'upload',
  ): Promise<UploadResult> {
    // Espelha o storage real: extensão derivada do arquivo, não fixa em .webp.
    const ext = path.extname(file.filename) || '.bin'
    const key = this.nextKey(folderConfig, ext)
    const url = `https://fake.storage/${key}`
    this.uploads.push({ key, url, size: file.buffer.length, deliveryType })
    return { key, url }
  }

  async uploadStream(
    file: StreamData,
    folderConfig: string,
    deliveryType: StorageDeliveryType = 'upload',
  ): Promise<StreamUploadResult> {
    // Consome o stream (como o provider real faria) e mede o tamanho.
    let bytes = 0
    for await (const chunk of file.stream) {
      bytes += (chunk as Buffer).length
    }
    if (this.forceOversizeBytes) {
      this.forceOversizeBytes = false
      bytes = 3_000_000_000
    }
    const ext = path.extname(file.filename) || '.bin'
    const key = this.nextKey(folderConfig, ext)
    const url = `https://fake.storage/${key}`
    this.uploads.push({ key, url, size: bytes, deliveryType })
    return { key, url, bytes }
  }

  // URL assinada determinística e reconhecível (marcador '/signed/'). Reflete o
  // resource_type e, se thumbnail, termina em .jpg (como o poster de vídeo).
  signedUrl(
    key: string,
    resourceType: StorageResourceType,
    opts?: { asThumbnail?: boolean },
  ): string {
    const suffix = opts?.asThumbnail ? '.jpg' : ''
    return `https://fake.storage/signed/${resourceType}/${key}${suffix}`
  }

  async delete(
    key: string,
    resourceType: StorageResourceType = 'image',
  ): Promise<void> {
    this.deleted.push(key)
    this.deletedResources.push({ key, resourceType })
  }

  signUpload(folder: string, resourceType: 'video'): UploadSignature {
    return {
      signature: 'fake-signature',
      timestamp: 1_749_000_000,
      apiKey: 'fake-api-key',
      cloudName: 'fake-cloud',
      folder,
      resourceType,
      type: 'authenticated',
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
    // Seam: simula o modo de pasta DINÂMICA do Cloudinary. Formato
    // 'dyn::<asset_folder>::<short_id>' → o public_id NÃO inclui o caminho da
    // pasta (vem só em asset_folder), como o provider reporta nesse modo. Cobre
    // o ramo `asset.folder === folder` do pertencimento.
    if (publicId.startsWith('dyn::')) {
      const [, folder, shortId] = publicId.split('::')
      return {
        publicId: shortId,
        url: `https://fake.storage/${shortId}.mp4`,
        bytes: 1_234_567,
        format: 'mp4',
        folder,
        durationMs: 8200,
        width: 1080,
        height: 1920,
        thumbnailUrl: `https://fake.storage/${shortId}.jpg`,
      }
    }
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
      thumbnailUrl: `https://fake.storage/${publicId}.jpg`,
    }
  }

  reset() {
    this.uploads = []
    this.deleted = []
    this.deletedResources = []
    this.forceOversizeBytes = false
  }
}

export const fakeStorage = new FakeStorageService()
