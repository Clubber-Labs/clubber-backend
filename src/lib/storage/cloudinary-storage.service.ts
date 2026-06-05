import { randomUUID } from 'node:crypto'
import { v2 as cloudinary } from 'cloudinary'
import type { CloudinaryCredentials } from '../env'
import { env } from '../env'
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

  async upload(
    file: FileData,
    folderConfig: string,
    deliveryType: StorageDeliveryType = 'upload',
  ): Promise<UploadResult> {
    return new Promise((resolve, reject) => {
      const fileId = randomUUID()
      const publicId = `${folderConfig}/${fileId}`

      const uploadStream = cloudinary.uploader.upload_stream(
        {
          public_id: publicId,
          resource_type: 'auto',
          type: deliveryType,
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

  async uploadStream(
    file: StreamData,
    folderConfig: string,
    deliveryType: StorageDeliveryType = 'upload',
  ): Promise<StreamUploadResult> {
    return new Promise((resolve, reject) => {
      const publicId = `${folderConfig}/${randomUUID()}`
      const dest = cloudinary.uploader.upload_stream(
        { public_id: publicId, resource_type: 'auto', type: deliveryType },
        (error, result) => {
          if (error || !result) {
            return reject(
              error || new Error('Falha no upload para o Cloudinary'),
            )
          }
          resolve({
            url: result.secure_url,
            key: result.public_id,
            bytes: result.bytes,
          })
        },
      )
      // Propaga erro do source pro destino (não deixa o upload pendurado).
      file.stream.on('error', (err) => dest.destroy(err))
      file.stream.pipe(dest)
    })
  }

  async delete(
    key: string,
    resourceType: StorageResourceType = 'image',
  ): Promise<void> {
    await cloudinary.uploader.destroy(key, { resource_type: resourceType })
  }

  signUpload(folder: string, resourceType: 'video'): UploadSignature {
    const timestamp = Math.round(Date.now() / 1000)
    const type: StorageDeliveryType = 'authenticated'
    // Assina folder + timestamp + type: o cliente envia exatamente esses params
    // (mais api_key/file). Trava a pasta na conversa (o cliente não escolhe) e
    // força entrega autenticada (o vídeo sobe privado, acessível só assinado).
    const signature = cloudinary.utils.api_sign_request(
      { folder, timestamp, type },
      this.credentials.apiSecret,
    )
    return {
      signature,
      timestamp,
      apiKey: this.credentials.apiKey,
      cloudName: this.credentials.cloudName,
      folder,
      resourceType,
      type,
    }
  }

  signedUrl(
    key: string,
    resourceType: StorageResourceType,
    opts?: { asThumbnail?: boolean },
  ): string {
    const authTokenKey = env.CLOUDINARY_AUTH_TOKEN_KEY
    return cloudinary.url(key, {
      type: 'authenticated',
      resource_type: resourceType,
      sign_url: true,
      secure: true,
      ...(opts?.asThumbnail && {
        format: 'jpg',
        transformation: [{ start_offset: 'auto' }],
      }),
      // Expiração real (opcional, recurso pago): com a auth token key
      // configurada, emite token com TTL; senão, sign_url eterno e não-forjável.
      ...(authTokenKey && {
        auth_token: { key: authTokenKey, duration: 60 * 60 },
      }),
    })
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
      // do public_id AUTORITATIVO do provider (r.public_id), nunca do publicId
      // recebido do cliente — esse valor entra na verificação de pertencimento.
      const folder =
        r.asset_folder ??
        r.folder ??
        r.public_id.split('/').slice(0, -1).join('/')
      // Poster gerado on-demand pelo Cloudinary: 1 frame representativo do vídeo
      // entregue como JPEG. Não custa storage nem transcoding (URL derivada).
      const thumbnailUrl = cloudinary.url(r.public_id, {
        resource_type: 'video',
        format: 'jpg',
        transformation: [{ start_offset: 'auto' }],
        // Explícito: cloudinary.url() pode ignorar o secure global em algumas
        // versões e gerar http://. A URL fica persistida, então força https.
        secure: true,
      })
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
        thumbnailUrl,
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
