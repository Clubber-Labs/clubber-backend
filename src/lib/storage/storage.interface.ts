export interface FileData {
  buffer: Buffer
  filename: string
  mimetype: string
}

export interface UploadResult {
  url: string
  key: string
}

export interface IStorageService {
  upload(file: FileData, folderConfig: string): Promise<UploadResult>
  delete(key: string): Promise<void>
}
