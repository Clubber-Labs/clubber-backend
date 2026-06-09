import type { Readable } from 'node:stream'

export interface FileData {
  buffer: Buffer
  filename: string
  mimetype: string
}

/** Mídia em stream (áudio/vídeo): sobe sem materializar o arquivo na memória. */
export interface StreamData {
  stream: Readable
  filename: string
  mimetype: string
}

export interface UploadResult {
  url: string
  key: string
}

/** Resultado do upload em stream: o tamanho vem do provider (não do buffer). */
export interface StreamUploadResult extends UploadResult {
  bytes: number
  // resource_type que o PROVIDER detectou no conteúdo real (não o mimetype do
  // cliente): 'video' para áudio/vídeo, 'image', ou 'raw' p/ não-mídia. Permite
  // rejeitar um arquivo cujo conteúdo não bate com o tipo declarado — e deletar
  // o órfão com o tipo CERTO.
  detectedResourceType: StorageResourceType
}

/**
 * Tipo de recurso no provider. O Cloudinary separa imagem de áudio/vídeo: ambos
 * áudio e vídeo são 'video'. 'raw' = arquivo não-mídia. Deletar com o tipo
 * errado falha silenciosamente (ex.: destroy de um 'raw' como 'video' não apaga).
 */
export type StorageResourceType = 'image' | 'video' | 'raw'

/**
 * Tipo de entrega no provider. 'upload' = público (default; avatar/evento).
 * 'authenticated' = privado, acessível só via URL assinada (mídia de chat).
 */
export type StorageDeliveryType = 'upload' | 'authenticated'

/** Credenciais assinadas para o cliente subir um arquivo DIRETO ao provider. */
export interface UploadSignature {
  signature: string
  timestamp: number
  apiKey: string
  cloudName: string
  folder: string
  resourceType: 'video'
  // Sempre 'authenticated': o cliente sobe com este `type` para o asset ficar
  // privado (acessível só via URL assinada). Vai dentro dos params assinados.
  type: 'authenticated'
}

/** Metadados autoritativos de um asset já hospedado no provider (fonte da verdade). */
export interface RemoteAsset {
  publicId: string
  url: string
  bytes: number
  format: string
  folder: string
  // Vídeo: duração em ms e dimensões nativas (null se o provider não reportar).
  durationMs: number | null
  width: number | null
  height: number | null
  // Vídeo: URL do poster (1 frame em JPEG) gerada pelo provider.
  thumbnailUrl: string | null
}

export interface IStorageService {
  // deliveryType default 'upload' (público) mantém avatar/evento intactos; a
  // mídia de chat passa 'authenticated' para o asset ficar privado.
  upload(
    file: FileData,
    folderConfig: string,
    deliveryType?: StorageDeliveryType,
  ): Promise<UploadResult>
  /** Sobe um stream sem bufferizar o arquivo inteiro (áudio). */
  uploadStream(
    file: StreamData,
    folderConfig: string,
    deliveryType?: StorageDeliveryType,
  ): Promise<StreamUploadResult>
  // resourceType default 'image' mantém os callers de imagem (avatar/evento)
  // intactos; áudio/vídeo passam 'video' para o destroy acertar o recurso.
  // deliveryType default 'upload' (público) mantém avatar/evento; mídia de chat
  // passa 'authenticated'. As DUAS dimensões precisam bater: destroy no namespace
  // errado retorna 'not found' e não apaga (asset órfão pago).
  delete(
    key: string,
    resourceType?: StorageResourceType,
    deliveryType?: StorageDeliveryType,
  ): Promise<void>
  /**
   * Gera uma URL de ENTREGA assinada (não-forjável) para um asset privado,
   * a partir do key/publicId. Síncrono (puro cálculo de assinatura, sem I/O).
   * `asThumbnail` deriva o poster JPEG de um vídeo.
   */
  signedUrl(
    key: string,
    resourceType: StorageResourceType,
    opts?: { asThumbnail?: boolean },
  ): string
  // Upload direto assinado (vídeo): o backend assina os params para o cliente
  // subir direto ao provider, e depois busca/verifica o asset resultante.
  signUpload(folder: string, resourceType: 'video'): UploadSignature
  getAsset(publicId: string, resourceType: 'video'): Promise<RemoteAsset | null>
}
