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
  REDIS_URL: z
    .string()
    .regex(/^rediss?:\/\//, 'REDIS_URL deve começar com redis:// ou rediss://')
    .optional(),
  STORAGE_DRIVER: z.enum(['cloudinary', 'local']).optional(),
  UPLOADS_DIR: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  FACEBOOK_APP_ID: z.string().optional(),
  FACEBOOK_APP_SECRET: z.string().optional(),
  FEATURED_RECONCILE_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(300000),
  // z.coerce.boolean() usa Boolean() do JS — "false"/"0" virariam true.
  // Aceita explicitamente as strings comuns e transforma manualmente.
  FEATURED_RECONCILE_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
    .default('info'),
})

const cloudinarySchema = z.object({
  CLOUDINARY_CLOUD_NAME_DEV: z.string().optional(),
  CLOUDINARY_API_KEY_DEV: z.string().optional(),
  CLOUDINARY_API_SECRET_DEV: z.string().optional(),
  CLOUDINARY_CLOUD_NAME_PROD: z.string().optional(),
  CLOUDINARY_API_KEY_PROD: z.string().optional(),
  CLOUDINARY_API_SECRET_PROD: z.string().optional(),
  // Opcional (recurso pago do Cloudinary): URL auth key para URLs assinadas com
  // EXPIRAÇÃO (auth_token). Sem ela, as URLs são assinadas mas não expiram.
  CLOUDINARY_AUTH_TOKEN_KEY: z.string().optional(),
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
  REDIS_URL: parsed.REDIS_URL,
  STORAGE_DRIVER,
  UPLOADS_DIR: path.resolve(
    parsed.UPLOADS_DIR ?? path.join(process.cwd(), 'uploads'),
  ),
  GOOGLE_CLIENT_ID: parsed.GOOGLE_CLIENT_ID,
  FACEBOOK_APP_ID: parsed.FACEBOOK_APP_ID,
  FACEBOOK_APP_SECRET: parsed.FACEBOOK_APP_SECRET,
  FEATURED_RECONCILE_INTERVAL_MS: parsed.FEATURED_RECONCILE_INTERVAL_MS,
  FEATURED_RECONCILE_ENABLED: parsed.FEATURED_RECONCILE_ENABLED,
  LOG_LEVEL: parsed.LOG_LEVEL,
  CLOUDINARY_AUTH_TOKEN_KEY: parsed.CLOUDINARY_AUTH_TOKEN_KEY,
} as const
