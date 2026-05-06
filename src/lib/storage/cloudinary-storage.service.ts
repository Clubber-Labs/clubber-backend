import { randomUUID } from 'node:crypto'
import { v2 as cloudinary } from 'cloudinary'
import type { CloudinaryCredentials } from '../env'
import type {
  FileData,
  IStorageService,
  UploadResult,
} from './storage.interface'

export class CloudinaryStorageService implements IStorageService {
  constructor(credentials: CloudinaryCredentials) {
    cloudinary.config({
      cloud_name: credentials.cloudName,
      api_key: credentials.apiKey,
      api_secret: credentials.apiSecret,
      secure: true,
    })
  }

  async upload(file: FileData, folderConfig: string): Promise<UploadResult> {
    return new Promise((resolve, reject) => {
      const fileId = randomUUID()
      const publicId = `${folderConfig}/${fileId}`

      const uploadStream = cloudinary.uploader.upload_stream(
        {
          public_id: publicId,
          resource_type: 'auto',
        },
        (error, result) => {
          if (error || !result) {
            return reject(
              error || new Error('Falha no upload para o Cloudinary'),
            )
          }

          resolve({
            url: result.secure_url,
            key: result.public_id,
          })
        },
      )

      uploadStream.end(file.buffer)
    })
  }

  async delete(key: string): Promise<void> {
    await cloudinary.uploader.destroy(key)
  }
}
