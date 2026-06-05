export interface FileData {
  buffer: Buffer
  filename: string
  mimetype: string
}

export interface UploadResult {
  url: string
  key: string
}

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
}

export interface IStorageService {
  upload(file: FileData, folderConfig: string): Promise<UploadResult>
  delete(key: string): Promise<void>
  // Upload direto assinado (vídeo): o backend assina os params para o cliente
  // subir direto ao provider, e depois busca/verifica o asset resultante.
  signUpload(folder: string, resourceType: 'video'): UploadSignature
  getAsset(publicId: string, resourceType: 'video'): Promise<RemoteAsset | null>
}
