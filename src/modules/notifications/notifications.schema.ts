import { z } from 'zod'

export const listNotificationsQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(50).optional().default(20),
  // Cursor opaco (base64url de { createdAt, id }) — keyset por (createdAt, id).
  cursor: z.string().optional(),
})

export type ListNotificationsQuery = z.infer<
  typeof listNotificationsQuerySchema
>

export const registerDeviceSchema = z.object({
  // Expo push token. A validação autoritativa (Expo.isExpoPushToken) é no
  // service; aqui só garante uma string não vazia.
  token: z.string().min(1),
  platform: z.string().max(20).optional(),
})

export type RegisterDeviceBody = z.infer<typeof registerDeviceSchema>

export const deviceTokenParamsSchema = z.object({ token: z.string().min(1) })

export const notificationIdParamsSchema = z.object({ id: z.string().uuid() })
