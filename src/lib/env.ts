import path from 'node:path'
import { z } from 'zod'

const baseSchema = z.object({
  DATABASE_URL: z.url(),
  JWT_SECRET: z.string().min(1, 'JWT_SECRET não configurado'),
  PORT: z.coerce.number().int().positive().default(3333),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PUBLIC_URL: z.url().default('http://localhost:3333'),
  STORAGE_DRIVER: z.enum(['cloudinary', 'local']).optional(),
  UPLOADS_DIR: z.string().optional(),
})

const cloudinarySchema = z.object({
  CLOUDINARY_CLOUD_NAME_DEV: z.string().optional(),
  CLOUDINARY_API_KEY_DEV: z.string().optional(),
  CLOUDINARY_API_SECRET_DEV: z.string().optional(),
  CLOUDINARY_CLOUD_NAME_PROD: z.string().optional(),
  CLOUDINARY_API_KEY_PROD: z.string().optional(),
  CLOUDINARY_API_SECRET_PROD: z.string().optional(),
})

const parsed = baseSchema.extend(cloudinarySchema.shape).parse(process.env)

const STORAGE_DRIVER: 'cloudinary' | 'local' =
  parsed.STORAGE_DRIVER ?? 'cloudinary'

export type CloudinaryCredentials = {
  cloudName: string
  apiKey: string
  apiSecret: string
}

export function resolveCloudinaryCredentials(): CloudinaryCredentials {
  const isProd = parsed.NODE_ENV === 'production'
  const cloudName = isProd
    ? parsed.CLOUDINARY_CLOUD_NAME_PROD
    : parsed.CLOUDINARY_CLOUD_NAME_DEV
  const apiKey = isProd
    ? parsed.CLOUDINARY_API_KEY_PROD
    : parsed.CLOUDINARY_API_KEY_DEV
  const apiSecret = isProd
    ? parsed.CLOUDINARY_API_SECRET_PROD
    : parsed.CLOUDINARY_API_SECRET_DEV

  if (!cloudName || !apiKey || !apiSecret) {
    const suffix = isProd ? 'PROD' : 'DEV'
    throw new Error(
      `Cloudinary não configurado para ${parsed.NODE_ENV}. Defina CLOUDINARY_CLOUD_NAME_${suffix}, CLOUDINARY_API_KEY_${suffix} e CLOUDINARY_API_SECRET_${suffix}.`,
    )
  }

  return { cloudName, apiKey, apiSecret }
}

export const env = {
  DATABASE_URL: parsed.DATABASE_URL,
  JWT_SECRET: parsed.JWT_SECRET,
  PORT: parsed.PORT,
  NODE_ENV: parsed.NODE_ENV,
  PUBLIC_URL: parsed.PUBLIC_URL,
  STORAGE_DRIVER,
  UPLOADS_DIR: path.resolve(parsed.UPLOADS_DIR ?? path.join(process.cwd(), 'uploads')),
} as const
