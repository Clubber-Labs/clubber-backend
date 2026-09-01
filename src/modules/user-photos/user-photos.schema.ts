import { z } from 'zod'

export const MAX_USER_PHOTO_IMAGES = 10
export const MAX_USER_PHOTO_CAPTION_LENGTH = 300

// Campo multipart em branco é como o app diz "sem legenda" / "sem evento".
const blankToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value

export const createUserPhotoFieldsSchema = z.object({
  caption: z.preprocess(
    blankToUndefined,
    z.string().trim().max(MAX_USER_PHOTO_CAPTION_LENGTH).optional(),
  ),
  eventId: z.preprocess(blankToUndefined, z.uuid().optional()),
})

export type CreateUserPhotoFields = z.infer<typeof createUserPhotoFieldsSchema>

export const userPhotoParamSchema = z.object({
  photoId: z.uuid('ID da foto inválido'),
})

export type UserPhotoParam = z.infer<typeof userPhotoParamSchema>

export const userPhotosQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  cursor: z.uuid().optional(),
})

export type UserPhotosQuery = z.infer<typeof userPhotosQuerySchema>
