import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { PassThrough, Readable } from 'node:stream'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import type { R2Credentials } from '../env'
import {
  SNIFF_BYTES,
  sniffResourceType,
  sniffVideoFormat,
} from './content-sniffer'
import { presignGetUrl, presignPutUrl } from './sigv4'
import type {
  FileData,
  IStorageService,
  RemoteAsset,
  StorageDeliveryType,
  StreamData,
  StreamUploadResult,
  UploadResult,
  UploadSignature,
} from './storage.interface'

const PRESIGNED_GET_TTL_SECONDS = 3600
const PRESIGNED_PUT_TTL_SECONDS = 900

// Extensão do upload direto de vídeo: contentType assinado no PUT vem de uma
// lista fechada (assertVideoFormat rejeita o resto no getAsset); fora dela, .bin.
const VIDEO_CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
}

export class R2StorageService implements IStorageService {
  private readonly credentials: R2Credentials
  private readonly client: S3Client

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
    deliveryType: StorageDeliveryType = 'upload',
  ): Promise<void> {
    // No S3 a key já identifica o objeto sozinha (sem namespace por tipo); o
    // delete é idempotente (sem warn de not-found).
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucketFor(deliveryType),
        Key: key,
      }),
    )
  }

  signedUrl(key: string): string {
    return presignGetUrl({
      accountId: this.credentials.accountId,
      accessKeyId: this.credentials.accessKeyId,
      secretAccessKey: this.credentials.secretAccessKey,
      bucket: this.credentials.bucketPrivate,
      key,
      expiresInSeconds: PRESIGNED_GET_TTL_SECONDS,
    })
  }

  signUpload(folder: string, contentType: string): UploadSignature {
    const ext = VIDEO_CONTENT_TYPE_EXTENSIONS[contentType] ?? '.bin'
    const key = `${folder}/${randomUUID()}${ext}`
    // Vídeo é sempre mídia de chat: sobe direto pro bucket PRIVADO, sem passar
    // pelo backend (o presign de PUT libera o cliente pra escrever só nessa key).
    const uploadUrl = presignPutUrl({
      accountId: this.credentials.accountId,
      accessKeyId: this.credentials.accessKeyId,
      secretAccessKey: this.credentials.secretAccessKey,
      bucket: this.credentials.bucketPrivate,
      key,
      expiresInSeconds: PRESIGNED_PUT_TTL_SECONDS,
      contentType,
    })
    const expiresAt = new Date(
      Date.now() + PRESIGNED_PUT_TTL_SECONDS * 1000,
    ).toISOString()
    return { uploadUrl, key, expiresAt }
  }

  async getAsset(key: string): Promise<RemoteAsset | null> {
    let bytes: number
    try {
      const head = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.credentials.bucketPrivate,
          Key: key,
        }),
      )
      bytes = head.ContentLength ?? 0
    } catch (err) {
      const name = (err as { name?: string })?.name
      if (name === 'NotFound' || name === '404') return null
      throw err
    }

    // bytes (cota) e format (tipo real, via magic bytes) são as duas validações
    // com peso de segurança aqui — o Content-Type do PUT é o que o CLIENTE disse.
    const range = await this.client.send(
      new GetObjectCommand({
        Bucket: this.credentials.bucketPrivate,
        Key: key,
        Range: `bytes=0-${SNIFF_BYTES - 1}`,
      }),
    )
    const head = range.Body
      ? Buffer.from(await range.Body.transformToByteArray())
      : Buffer.alloc(0)
    const format = sniffVideoFormat(head) ?? 'unknown'

    return { key, bytes, format }
  }
}
