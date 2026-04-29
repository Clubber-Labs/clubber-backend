import type { FileData, IStorageService, UploadResult } from '../lib/storage'

export class FakeStorageService implements IStorageService {
  uploads: { key: string; url: string; size: number }[] = []
  deleted: string[] = []

  async upload(file: FileData, folderConfig: string): Promise<UploadResult> {
    const key = `${folderConfig}/${this.uploads.length + 1}.webp`
    const url = `https://fake.storage/${key}`
    this.uploads.push({ key, url, size: file.buffer.length })
    return { key, url }
  }

  async delete(key: string): Promise<void> {
    this.deleted.push(key)
  }

  reset() {
    this.uploads = []
    this.deleted = []
  }
}

export const fakeStorage = new FakeStorageService()
