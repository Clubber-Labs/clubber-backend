import { env, resolveR2Credentials } from '../env'
import { LocalStorageService } from './local-storage.service'
import { R2StorageService } from './r2-storage.service'
import type { IStorageService } from './storage.interface'

let instance: IStorageService | null = null

export function getStorage(): IStorageService {
  if (instance) return instance

  instance =
    env.STORAGE_DRIVER === 'local'
      ? new LocalStorageService()
      : new R2StorageService(resolveR2Credentials())

  return instance
}

/** Permite injetar um storage customizado em testes. */
export function setStorage(svc: IStorageService): void {
  instance = svc
}

export * from './storage.interface'
