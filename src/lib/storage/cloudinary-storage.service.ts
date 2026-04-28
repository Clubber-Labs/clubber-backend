import { randomUUID } from 'node:crypto'
import { v2 as cloudinary } from 'cloudinary'
import type {
  FileData,
  IStorageService,
  UploadResult,
} from './storage.interface'

export class CloudinaryStorageService implements IStorageService {
  constructor() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
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
            return reject(error || new Error('Upload to Cloudinary failed'))
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
    try {
      await cloudinary.uploader.destroy(key)
    } catch (err) {
      console.error(`Cloudinary Delete Error (${key}):`, err)
    }
  }
}
