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

// Geohash base32 (sem a/i/l/o) de precisão EXATA 6 (~1.2km). Precisão fixa
// porque o over-notify da query de proximidade é calibrado para ela; mais fino
// reduz a minimização (privacidade), mais grosso fura o raio. O app calcula e
// envia só o geohash — a coordenada precisa nunca chega ao servidor.
export const GEOHASH6_REGEX = /^[0-9bcdefghjkmnpqrstuvwxyz]{6}$/

export const updateLocationSchema = z.object({
  geohash: z.string().regex(GEOHASH6_REGEX, 'geohash inválido (precisão 6)'),
})

export type UpdateLocationBody = z.infer<typeof updateLocationSchema>

export const updateNotificationPrefsSchema = z.object({
  // Raio de interesse (km). O teto (NOTIFY_MAX_RADIUS_KM, que é também a constante
  // do pré-filtro indexável) é enforçado no service — fonte única do invariante
  // notifyRadiusKm ≤ NOTIFY_MAX_RADIUS_KM, em vez de um literal que não acompanha o env.
  notifyRadiusKm: z.coerce.number().int().min(2),
})

export type UpdateNotificationPrefsBody = z.infer<
  typeof updateNotificationPrefsSchema
>
