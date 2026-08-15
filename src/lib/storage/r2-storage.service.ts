import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { PassThrough, Readable } from 'node:stream'
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import type { R2Credentials } from '../env'
import { resolveCloudinaryCredentials } from '../env'
import { CloudinaryStorageService } from './cloudinary-storage.service'
import { SNIFF_BYTES, sniffResourceType } from './content-sniffer'
import { presignGetUrl } from './sigv4'
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

const PRESIGNED_GET_TTL_SECONDS = 3600

export class R2StorageService implements IStorageService {
  private readonly credentials: R2Credentials
  private readonly client: S3Client
  // Delegação lazy: só instancia o driver Cloudinary (e exige suas credenciais)
  // na primeira chamada de vídeo — ambiente só-R2 sobe e serve imagem/áudio sem elas.
  private cloudinaryDelegate: CloudinaryStorageService | null = null

  constructor(credentials: R2Credentials) {
    this.credentials = credentials
    this.client = new S3Client({
      endpoint: `https://${credentials.accountId}.r2.cloudflarestorage.com`,
      region: 'auto',
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
      },
      forcePathStyle: true,
      // O R2 não implementa checksums de multipart (x-amz-checksum-*); a SDK
      // ≥3.729 envia CRC32 por padrão, o que quebraria o upload no R2.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })
  }

  private get cloudinary(): CloudinaryStorageService {
    if (!this.cloudinaryDelegate) {
      this.cloudinaryDelegate = new CloudinaryStorageService(
        resolveCloudinaryCredentials(),
      )
    }
    return this.cloudinaryDelegate
  }

  private bucketFor(deliveryType: StorageDeliveryType): string {
    return deliveryType === 'authenticated'
      ? this.credentials.bucketPrivate
      : this.credentials.bucketPublic
  }

  private buildKey(folderConfig: string, filename: string): string {
    const ext = path.extname(filename) || '.bin'
    return `${folderConfig}/${randomUUID()}${ext}`
  }

  private resultUrl(key: string, deliveryType: StorageDeliveryType): string {
    if (deliveryType === 'authenticated') {
      return presignGetUrl({
        accountId: this.credentials.accountId,
        accessKeyId: this.credentials.accessKeyId,
        secretAccessKey: this.credentials.secretAccessKey,
        bucket: this.credentials.bucketPrivate,
        key,
        expiresInSeconds: PRESIGNED_GET_TTL_SECONDS,
      })
    }
    return `${this.credentials.publicBaseUrl}/${key}`
  }

  async upload(
    file: FileData,
    folderConfig: string,
    deliveryType: StorageDeliveryType = 'upload',
  ): Promise<UploadResult> {
    const key = this.buildKey(folderConfig, file.filename)
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketFor(deliveryType),
        Key: key,
        Body: file.buffer,
        // Obrigatório: o R2 devolve exatamente o que foi gravado. Sem isso um
        // .m4a salvo como octet-stream não toca no app.
        ContentType: file.mimetype,
      }),
    )
    return { url: this.resultUrl(key, deliveryType), key }
  }

  // Faz o peek dos primeiros SNIFF_BYTES sem perder dados: acumula chunks até
  // atingir o teto (ou o stream acabar) e recompõe um stream com o head na
  // frente do restante — o Upload do lib-storage lê esse stream normalmente.
  private async peekHead(
    source: Readable,
  ): Promise<{ head: Buffer; stream: Readable }> {
    const chunks: Buffer[] = []
    let collected = 0

    const head = await new Promise<Buffer>((resolve, reject) => {
      const onData = (chunk: Buffer) => {
        chunks.push(chunk)
        collected += chunk.length
        if (collected >= SNIFF_BYTES) {
          source.pause()
          source.off('data', onData)
          source.off('end', onEnd)
          source.off('error', onError)
          resolve(Buffer.concat(chunks))
        }
      }
      const onEnd = () => {
        source.off('data', onData)
        source.off('error', onError)
        resolve(Buffer.concat(chunks))
      }
      const onError = (err: Error) => {
        source.off('data', onData)
        source.off('end', onEnd)
        reject(err)
      }
      source.on('data', onData)
      source.on('end', onEnd)
      source.on('error', onError)
    })

    const rest = new PassThrough()
    // Propaga erro do source pro stream recomposto (não deixa o upload pendurado).
    source.on('error', (err) => rest.destroy(err))
    source.pipe(rest)

    const recomposed = new Readable({
      read() {},
    })
    recomposed.push(head)
    rest.on('data', (chunk) => recomposed.push(chunk))
    rest.on('end', () => recomposed.push(null))
    rest.on('error', (err) => recomposed.destroy(err))

    return { head, stream: recomposed }
  }

  async uploadStream(
    file: StreamData,
    folderConfig: string,
    deliveryType: StorageDeliveryType = 'upload',
  ): Promise<StreamUploadResult> {
    const { head, stream } = await this.peekHead(file.stream)
    const detectedResourceType = sniffResourceType(head)

    let bytes = 0
    stream.on('data', (chunk: Buffer) => {
      bytes += chunk.length
    })

    const key = this.buildKey(folderConfig, file.filename)
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucketFor(deliveryType),
        Key: key,
        Body: stream,
        ContentType: file.mimetype,
      },
    })
    await upload.done()

    return {
      url: this.resultUrl(key, deliveryType),
      key,
      bytes,
      detectedResourceType,
    }
  }

  async delete(
    key: string,
    _resourceType: StorageResourceType = 'image',
    deliveryType: StorageDeliveryType = 'upload',
  ): Promise<void> {
    // resourceType era namespace do Cloudinary (image/video/raw); no S3 a key já
    // identifica o objeto sozinha, e o delete é idempotente (sem warn de not-found).
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucketFor(deliveryType),
        Key: key,
      }),
    )
  }

  signedUrl(
    key: string,
    resourceType: StorageResourceType,
    opts?: { asThumbnail?: boolean },
  ): string {
    // Poster de vídeo legado: delega ao Cloudinary (fase 1 não migra vídeo).
    if (opts?.asThumbnail) {
      return this.cloudinary.signedUrl(key, resourceType, opts)
    }
    return presignGetUrl({
      accountId: this.credentials.accountId,
      accessKeyId: this.credentials.accessKeyId,
      secretAccessKey: this.credentials.secretAccessKey,
      bucket: this.credentials.bucketPrivate,
      key,
      expiresInSeconds: PRESIGNED_GET_TTL_SECONDS,
    })
  }

  signUpload(folder: string, resourceType: 'video'): UploadSignature {
    return this.cloudinary.signUpload(folder, resourceType)
  }

  async getAsset(
    publicId: string,
    resourceType: 'video',
  ): Promise<RemoteAsset | null> {
    return this.cloudinary.getAsset(publicId, resourceType)
  }
}
