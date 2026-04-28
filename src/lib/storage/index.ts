import { CloudinaryStorageService } from './cloudinary-storage.service'
import type { IStorageService } from './storage.interface'

export const storageService: IStorageService = new CloudinaryStorageService()

export * from './storage.interface'
