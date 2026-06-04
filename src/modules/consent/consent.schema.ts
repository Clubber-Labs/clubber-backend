import { z } from 'zod'

/** Versão atual da política de privacidade */
export const CURRENT_CONSENT_VERSION = '1.0'

/** Os 7 campos de consentimento granular — exatamente conforme a Política de Privacidade v1.0 */
export const consentFieldsSchema = z.object({
  locationPrecise:   z.boolean(),  // Localização precisa (GPS)
  socialFeed:        z.boolean(),  // Feed social personalizado
  socialVisibility:  z.boolean(),  // Visibilidade de atividades sociais
  pushNotifications: z.boolean(),  // Notificações push
  marketing:         z.boolean(),  // Comunicações de marketing
  analytics:         z.boolean(),  // Analytics e métricas de uso
  surveys:           z.boolean(),  // Participação em pesquisas
})

export const createConsentSchema = consentFieldsSchema

export const updateConsentSchema = consentFieldsSchema.partial()

export type CreateConsentBody = z.infer<typeof createConsentSchema>
export type UpdateConsentBody = z.infer<typeof updateConsentSchema>

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
