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
}

/**
 * Tipo de recurso no provider. O Cloudinary separa imagem de áudio/vídeo: ambos
 * áudio e vídeo são 'video'. Deletar com o tipo errado falha silenciosamente.
 */
export type StorageResourceType = 'image' | 'video'

/** Credenciais assinadas para o cliente subir um arquivo DIRETO ao provider. */
export interface UploadSignature {
  signature: string
  timestamp: number
  apiKey: string
  cloudName: string
  folder: string
  resourceType: 'video'
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
  upload(file: FileData, folderConfig: string): Promise<UploadResult>
  /** Sobe um stream sem bufferizar o arquivo inteiro (áudio). */
  uploadStream(
    file: StreamData,
    folderConfig: string,
  ): Promise<StreamUploadResult>
  // resourceType default 'image' mantém os callers de imagem (avatar/evento)
  // intactos; áudio/vídeo passam 'video' para o destroy acertar o recurso.
  delete(key: string, resourceType?: StorageResourceType): Promise<void>
  // Upload direto assinado (vídeo): o backend assina os params para o cliente
  // subir direto ao provider, e depois busca/verifica o asset resultante.
  signUpload(folder: string, resourceType: 'video'): UploadSignature
  getAsset(publicId: string, resourceType: 'video'): Promise<RemoteAsset | null>
}
