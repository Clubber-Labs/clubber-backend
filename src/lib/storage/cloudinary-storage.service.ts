import { randomUUID } from 'node:crypto'
import { v2 as cloudinary } from 'cloudinary'
import type { CloudinaryCredentials } from '../env'
import type {
  FileData,
  IStorageService,
  RemoteAsset,
  UploadResult,
  UploadSignature,
} from './storage.interface'

export class CloudinaryStorageService implements IStorageService {
  private readonly credentials: CloudinaryCredentials

  constructor(credentials: CloudinaryCredentials) {
    this.credentials = credentials
    cloudinary.config({
      cloud_name: credentials.cloudName,
      api_key: credentials.apiKey,
      api_secret: credentials.apiSecret,
      secure: true,
    })
  }

  async upload(file: FileData, folderConfig: string): Promise<UploadResult> {
    return new Promise((resolve, reject) => {
      const fileId = randomUUID()
      const publicId = `${folderConfig}/${fileId}`

      const uploadStream = cloudinary.uploader.upload_stream(
        {
          public_id: publicId,
          resource_type: 'auto',
        },
        (error, result) => {
          if (error || !result) {
            return reject(
              error || new Error('Falha no upload para o Cloudinary'),
            )
          }

          resolve({
            url: result.secure_url,
            key: result.public_id,
          })
        },
      )

      uploadStream.end(file.buffer)
    })
  }

  async delete(key: string): Promise<void> {
    await cloudinary.uploader.destroy(key)
  }

  signUpload(folder: string, resourceType: 'video'): UploadSignature {
    const timestamp = Math.round(Date.now() / 1000)
    // Assina apenas folder + timestamp: o cliente envia exatamente esses params
    // (mais api_key/file). Trava a pasta na conversa — o cliente não escolhe.
    const signature = cloudinary.utils.api_sign_request(
      { folder, timestamp },
      this.credentials.apiSecret,
    )
    return {
      signature,
      timestamp,
      apiKey: this.credentials.apiKey,
      cloudName: this.credentials.cloudName,
      folder,
      resourceType,
    }
  }

  async getAsset(
    publicId: string,
    resourceType: 'video',
  ): Promise<RemoteAsset | null> {
    try {
      const r = await cloudinary.api.resource(publicId, {
        resource_type: resourceType,
      })
      // Pastas dinâmicas reportam asset_folder; as fixas, folder. Fallback: deriva
      // do public_id (tudo antes do último segmento).
      const folder =
        r.asset_folder ?? r.folder ?? publicId.split('/').slice(0, -1).join('/')
      return {
        publicId: r.public_id,
        url: r.secure_url,
        bytes: r.bytes,
        format: r.format,
        folder,
        durationMs:
          typeof r.duration === 'number' ? Math.round(r.duration * 1000) : null,
        width: typeof r.width === 'number' ? r.width : null,
        height: typeof r.height === 'number' ? r.height : null,
      }
    } catch (err) {
      // Asset inexistente → 404 do Cloudinary vira null (o service trata como 400).
      const httpCode =
        (err as { error?: { http_code?: number }; http_code?: number })?.error
          ?.http_code ?? (err as { http_code?: number })?.http_code
      if (httpCode === 404) return null
      throw err
    }
  }
}
