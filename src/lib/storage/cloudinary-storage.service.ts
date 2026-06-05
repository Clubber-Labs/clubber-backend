import { randomUUID } from 'node:crypto'
import { v2 as cloudinary } from 'cloudinary'
import type { CloudinaryCredentials } from '../env'
import { env } from '../env'
import { logger } from '../logger'
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

/** Normaliza o resource_type do provider; tipo inesperado vira 'raw' (não-mídia). */
function toResourceType(value: string): StorageResourceType {
  return value === 'image' || value === 'video' || value === 'raw'
    ? value
    : 'raw'
}

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
          // No modo "dynamic folders" da conta, slash no public_id NÃO cria pasta
          // na Media Library — só asset_folder posiciona o asset. Sem isto, todo
          // upload via backend (imagem/áudio/avatar/evento) cai na raiz ("home").
          // O public_id segue com o caminho (key/delete/ownership inalterados).
          asset_folder: folderConfig,
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
        {
          public_id: publicId,
          // Mesma razão do upload(): asset_folder posiciona o asset na pasta da
          // conversa no modo dynamic folders (slash no public_id não basta).
          asset_folder: folderConfig,
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
            bytes: result.bytes,
            // O que o Cloudinary detectou no conteúdo (resource_type 'auto').
            // Coage defensivamente: um tipo inesperado vira 'raw' (não-mídia →
            // rejeitado pelo content-check), em vez de um cast cego.
            detectedResourceType: toResourceType(result.resource_type),
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
    deliveryType: StorageDeliveryType = 'upload',
  ): Promise<void> {
    // type: o asset privado (chat) vive no namespace 'authenticated'; destroy sem
    // ele mira 'upload' e NÃO apaga. invalidate: purga o asset E seus derivados
    // (ex.: poster do vídeo) do CDN — senão o thumbnail ficaria em cache acessível.
    const result = await cloudinary.uploader.destroy(key, {
      resource_type: resourceType,
      type: deliveryType,
      invalidate: true,
    })
    // destroy no namespace errado NÃO lança: resolve com { result: 'not found' }.
    // Sem logar, um delete no type errado deixaria um órfão pago invisível.
    if (result?.result === 'not found') {
      logger.warn(
        `destroy não encontrou o asset '${key}' (resource_type=${resourceType}, type=${deliveryType}) — namespace errado? asset pode ter ficado órfão`,
      )
    }
  }

  signUpload(folder: string, resourceType: 'video'): UploadSignature {
    const timestamp = Math.round(Date.now() / 1000)
    const type = 'authenticated' as const
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
        // O vídeo de chat é sempre 'authenticated' (signUpload força). resource()
        // sem type procura no namespace 'upload' → 404 no asset privado → null.
        type: 'authenticated',
        // Sem media_metadata o Cloudinary NÃO retorna r.duration (vem undefined →
        // durationMs persistido como null).
        media_metadata: true,
      })
      // Pastas dinâmicas reportam asset_folder; as fixas, folder. Fallback: deriva
      // do public_id AUTORITATIVO do provider (r.public_id), nunca do publicId
      // recebido do cliente — esse valor entra na verificação de pertencimento.
      const folder =
        r.asset_folder ??
        r.folder ??
        r.public_id.split('/').slice(0, -1).join('/')
      // Poster (1 frame em JPEG) gerado on-demand pelo Cloudinary. O vídeo é
      // 'authenticated' (privado), então o thumbnail também precisa ser ASSINADO
      // — senão a URL persistida apontaria para entrega pública e daria 401.
      const thumbnailUrl = this.signedUrl(r.public_id, 'video', {
        asThumbnail: true,
      })
      // O SDK tipa duration como number | string. Uma string numérica ("4.035")
      // cairia no ramo null sem a coerção → durationMs perdido.
      const durationSec =
        typeof r.duration === 'number'
          ? r.duration
          : typeof r.duration === 'string'
            ? Number(r.duration)
            : Number.NaN
      return {
        publicId: r.public_id,
        url: r.secure_url,
        bytes: r.bytes,
        format: r.format,
        folder,
        durationMs: Number.isFinite(durationSec)
          ? Math.round(durationSec * 1000)
          : null,
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
