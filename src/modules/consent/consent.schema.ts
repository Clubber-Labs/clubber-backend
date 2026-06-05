import { z } from 'zod'

/** Versão atual da política de privacidade */
export const CURRENT_CONSENT_VERSION = '1.0'

/** Os 7 campos de consentimento granular — exatamente conforme a Política de Privacidade v1.0 */
export const consentFieldsSchema = z.object({
  locationPrecise: z.boolean(), // Localização precisa (GPS)
  socialFeed: z.boolean(), // Feed social personalizado
  socialVisibility: z.boolean(), // Visibilidade de atividades sociais
  pushNotifications: z.boolean(), // Notificações push
  marketing: z.boolean(), // Comunicações de marketing
  analytics: z.boolean(), // Analytics e métricas de uso
  surveys: z.boolean(), // Participação em pesquisas
})

export const createConsentSchema = consentFieldsSchema

export const updateConsentSchema = consentFieldsSchema.partial()

export const consentActionSchema = z.enum([
  'GRANTED',
  'UPDATED',
  'REVOKED',
  'EXPORTED',
])

/** Shape público do consentimento — sem ipAddress/userAgent (campos técnicos internos) */
export const consentResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  essentialAccepted: z.boolean(),
  locationPrecise: z.boolean(),
  socialFeed: z.boolean(),
  socialVisibility: z.boolean(),
  pushNotifications: z.boolean(),
  marketing: z.boolean(),
  analytics: z.boolean(),
  surveys: z.boolean(),
  consentVersion: z.string(),
  collectedAt: z.date(),
  updatedAt: z.date(),
  revokedAt: z.date().nullable(),
})

/** Shape de uma entrada do audit log */
export const auditLogEntrySchema = z.object({
  id: z.string(),
  userId: z.string(),
  action: consentActionSchema,
  changedFields: z.unknown(), // JSON — validado na escrita, não na leitura
  consentVersion: z.string(),
  createdAt: z.date(),
  // ipAddress e userAgent omitidos propositalmente
})

/** Query params para paginação do audit log */
export const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().uuid().optional(),
})

export const auditResponseSchema = z.object({
  logs: z.array(auditLogEntrySchema),
  nextCursor: z.string().nullable(),
})

export const revokeConsentResponseSchema = z.object({
  message: z.string(),
})

export const exportResponseSchema = z.object({
  exportedAt: z.string(),
  currentConsent: consentResponseSchema.nullable(),
  history: z.array(auditLogEntrySchema),
})

export type CreateConsentBody = z.infer<typeof createConsentSchema>
export type UpdateConsentBody = z.infer<typeof updateConsentSchema>
export type AuditQuery = z.infer<typeof auditQuerySchema>

export type ConsentField = keyof z.infer<typeof consentFieldsSchema>

export const ALL_CONSENT_FIELDS: ConsentField[] = [
  'locationPrecise',
  'socialFeed',
  'socialVisibility',
  'pushNotifications',
  'marketing',
  'analytics',
  'surveys',
]
