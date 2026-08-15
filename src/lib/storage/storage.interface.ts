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
  // Categoria de mídia detectada por magic bytes (sniffer local) no conteúdo
  // real (não o mimetype do cliente): 'video' para áudio/vídeo, 'image', ou
  // 'raw' p/ não-mídia. Permite rejeitar um arquivo cujo conteúdo não bate com
  // o tipo declarado — e deletar o órfão com o bucket certo.
  detectedResourceType: StorageResourceType
}

/**
 * Categoria de mídia detectada por magic bytes (sniffer local), não mais
 * namespace do provider. 'raw' = arquivo não-mídia.
 */
export type StorageResourceType = 'image' | 'video' | 'raw'

/**
 * Tipo de entrega no provider. 'upload' = bucket público (default; avatar/
 * evento). 'authenticated' = bucket privado, acessível só via URL assinada
 * (mídia de chat).
 */
export type StorageDeliveryType = 'upload' | 'authenticated'

/** Credenciais assinadas para o cliente subir um arquivo DIRETO ao provider (presigned PUT). */
export interface UploadSignature {
  uploadUrl: string
  // Key definida pelo servidor (não pelo cliente) — trava a pasta na conversa.
  key: string
  expiresAt: string
}

/** Metadados autoritativos de um asset já hospedado no provider (fonte da verdade). */
export interface RemoteAsset {
  key: string
  bytes: number
  format: string
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
  // deliveryType default 'upload' (público) mantém avatar/evento; mídia de
  // chat passa 'authenticated'. Bucket errado deleta o objeto errado (ou nada).
  delete(key: string, deliveryType?: StorageDeliveryType): Promise<void>
  /**
   * Gera uma URL de ENTREGA assinada (não-forjável) para um asset privado,
   * a partir da key. Síncrono (puro cálculo de assinatura, sem I/O).
   */
  signedUrl(key: string): string
  // Upload direto assinado (vídeo): o backend assina um PUT para o cliente
  // subir direto ao provider, e depois busca/verifica o asset resultante.
  signUpload(folder: string, contentType: string): UploadSignature
  getAsset(key: string): Promise<RemoteAsset | null>
}
