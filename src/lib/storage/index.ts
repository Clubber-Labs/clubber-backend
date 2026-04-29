import { env, resolveCloudinaryCredentials } from '../env'
import { CloudinaryStorageService } from './cloudinary-storage.service'
import { LocalStorageService } from './local-storage.service'
import type { IStorageService } from './storage.interface'

let instance: IStorageService | null = null

export function getStorage(): IStorageService {
  if (instance) return instance

  instance =
    env.STORAGE_DRIVER === 'local'
      ? new LocalStorageService()
      : new CloudinaryStorageService(resolveCloudinaryCredentials())

  return instance
}

/** Permite injetar um storage customizado em testes. */
export function setStorage(svc: IStorageService): void {
  instance = svc
}

export * from './storage.interface'
