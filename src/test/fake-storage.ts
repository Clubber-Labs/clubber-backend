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

// Mesma tabela do driver real (r2-storage.service.ts): contentType -> extensão.
const VIDEO_CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
}

export class FakeStorageService implements IStorageService {
  uploads: {
    key: string
    url: string
    size: number
    deliveryType: StorageDeliveryType
  }[] = []
  deleted: string[] = []
  deletedResources: { key: string; deliveryType: StorageDeliveryType }[] = []
  // Seam de teste: força o próximo uploadStream a reportar um tamanho acima do
  // int4 do Postgres (> 2.147B). O insert do attachment estoura ("value out of
  // range for type integer") → permite testar o delete compensatório sem mockar
  // o Prisma (a falha vem do banco real).
  forceOversizeBytes = false
  // Seam de teste: simula o provider detectando que o conteúdo NÃO é mídia
  // (ex.: o cliente mandou texto/HTML com Content-Type de áudio). O próximo
  // uploadStream reporta esse resource_type detectado.
  forceDetectedResourceType: StorageResourceType | null = null
  // Contador próprio pro signUpload: não pode colidir com `uploads.length`
  // (upload/uploadStream), senão duas chamadas intercaladas gerariam a mesma key.
  private signCounter = 0

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
    const detectedResourceType = this.forceDetectedResourceType ?? 'video'
    this.forceDetectedResourceType = null
    const ext = path.extname(file.filename) || '.bin'
    const key = this.nextKey(folderConfig, ext)
    const url = `https://fake.storage/${key}`
    this.uploads.push({ key, url, size: bytes, deliveryType })
    return { key, url, bytes, detectedResourceType }
  }

  // URL assinada determinística e reconhecível (marcador '/signed/').
  signedUrl(key: string): string {
    return `https://fake.storage/signed/${key}`
  }

  async delete(
    key: string,
    deliveryType: StorageDeliveryType = 'upload',
  ): Promise<void> {
    this.deleted.push(key)
    this.deletedResources.push({ key, deliveryType })
  }

  signUpload(folder: string, contentType: string): UploadSignature {
    this.signCounter += 1
    const ext = VIDEO_CONTENT_TYPE_EXTENSIONS[contentType] ?? '.bin'
    const key = `${folder}/${this.signCounter}${ext}`
    return {
      uploadUrl: `https://fake.storage/put/${key}`,
      key,
      expiresAt: '2099-01-01T00:00:00.000Z',
    }
  }

  // Simula o Admin API do provider de forma determinística. Convenções na key
  // disparam os caminhos de erro do service:
  // - contém 'missing'   → asset inexistente (null)
  // - contém 'badformat' → formato não permitido
  // - contém 'toobig'    → acima do limite de tamanho
  async getAsset(key: string): Promise<RemoteAsset | null> {
    if (key.includes('missing')) return null
    if (key.includes('badformat'))
      return { key, bytes: 1_234_567, format: 'avi' }
    if (key.includes('toobig'))
      return { key, bytes: 60 * 1024 * 1024, format: 'mp4' }
    return { key, bytes: 1_234_567, format: 'mp4' }
  }

  reset() {
    this.uploads = []
    this.deleted = []
    this.deletedResources = []
    this.forceOversizeBytes = false
    this.forceDetectedResourceType = null
    this.signCounter = 0
  }
}

export const fakeStorage = new FakeStorageService()
