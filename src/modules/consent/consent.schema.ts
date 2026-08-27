import type { TermsDocument } from '@prisma/client'
import { z } from 'zod'

/** Versão vigente de cada documento — Termos de Uso e Política versionam separado. */
export const CURRENT_DOCUMENT_VERSIONS = {
  TERMS_OF_USE: '1.0',
  PRIVACY_POLICY: '1.0',
} as const satisfies Record<TermsDocument, string>

/** `consentVersion` é a versão da Política de Privacidade sob a qual o consentimento foi colhido. */
export const CURRENT_CONSENT_VERSION = CURRENT_DOCUMENT_VERSIONS.PRIVACY_POLICY

/**
 * Espelho da permissão do SO: quem decide é o iOS/Android, o app só replica
 * quando ela muda. Ligar um destes não é declaração de vontade — por isso não
 * reativa um consentimento revogado (ver `reactivate` no service).
 */
export const deviceMirrorFieldsSchema = z.object({
  locationPrecise: z.boolean(), // Localização precisa (GPS)
  pushNotifications: z.boolean(), // Notificações push
})

/** Consentimento no sentido estrito: opt-in explícito do usuário. */
export const consentFieldsSchema = z.object({
  marketing: z.boolean(), // Comunicações de marketing
  surveys: z.boolean(), // Participação em pesquisas
})

/**
 * Consentimento DERIVADO de outra entidade: vale enquanto o vínculo existir, e
 * quem o escreve é o módulo dono. Terceira categoria de propósito — fica fora
 * do PATCH (ligar não é ação isolada do titular, e aceitar do cliente deixaria
 * o registro divergir do vínculo real) e fora do STRICT, porque vincular uma
 * conta não é reconsentir a marketing. Entra no ALL: a revogação zera junto.
 */
export const derivedConsentFieldsSchema = z.object({
  spotifyData: z.boolean(), // Gosto musical importado do Spotify
})

/** O que o titular edita direto no PATCH /consent. */
const userEditableFieldsSchema = deviceMirrorFieldsSchema.extend(
  consentFieldsSchema.shape,
)

const allConsentFieldsSchema = userEditableFieldsSchema.extend(
  derivedConsentFieldsSchema.shape,
)

export const updateConsentSchema = userEditableFieldsSchema
  .partial()
  // Recusa em vez de ignorar em silêncio: um cliente mandando spotifyData está
  // com a expectativa errada, e engolir o campo esconderia isso.
  .strict()

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
  pushNotifications: z.boolean(),
  marketing: z.boolean(),
  surveys: z.boolean(),
  spotifyData: z.boolean(),
  consentVersion: z.string(),
  collectedAt: z.date(),
  updatedAt: z.date(),
  revokedAt: z.date().nullable(),
})

/** Preferências de produto, que moram no User — expostas só no export do Art. 18 */
export const userPreferencesResponseSchema = z.object({
  socialFeed: z.boolean(),
  socialVisibility: z.boolean(),
  analytics: z.boolean(),
  spotifyArtistsVisible: z.boolean(),
  spotifyTopArtistVisible: z.boolean(),
  spotifyWindowVisible: z.boolean(),
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
  preferences: userPreferencesResponseSchema.nullable(),
  termsAcceptances: z.array(
    z.object({
      document: z.enum(['TERMS_OF_USE', 'PRIVACY_POLICY']),
      version: z.string(),
      acceptedAt: z.date(),
    }),
  ),
  // null quando não há conta vinculada. Sem o refresh token: é credencial de
  // acesso a outro serviço, não dado do titular.
  spotify: z
    .object({
      spotifyUserId: z.string(),
      displayName: z.string().nullable(),
      scopes: z.array(z.string()),
      status: z.enum(['ACTIVE', 'REVOKED']),
      hiddenArtistIds: z.array(z.string()),
      lastSyncedAt: z.date().nullable(),
      createdAt: z.date(),
      // As TRÊS janelas: portabilidade é do dado inteiro, não de um recorte.
      snapshots: z.array(
        z.object({
          timeRange: z.string(),
          artists: z.unknown(),
          genreKeys: z.array(z.string()),
          syncedAt: z.date(),
        }),
      ),
    })
    .nullable(),
  history: z.array(auditLogEntrySchema),
})

export type UpdateConsentBody = z.infer<typeof updateConsentSchema>
export type AuditQuery = z.infer<typeof auditQuerySchema>

export type ConsentField = keyof z.infer<typeof allConsentFieldsSchema>
export type DeviceMirrorField = keyof z.infer<typeof deviceMirrorFieldsSchema>

export const DEVICE_MIRROR_FIELDS = Object.keys(
  deviceMirrorFieldsSchema.shape,
) as DeviceMirrorField[]

/** Só estes reativam um consentimento revogado — espelho do SO não conta. */
export const STRICT_CONSENT_FIELDS = Object.keys(
  consentFieldsSchema.shape,
) as ConsentField[]

export const ALL_CONSENT_FIELDS = Object.keys(
  allConsentFieldsSchema.shape,
) as ConsentField[]

export type DerivedConsentField = keyof z.infer<
  typeof derivedConsentFieldsSchema
>

/**
 * Preferências de produto que vivem no User mas são desligadas junto na
 * revogação do Art. 18 — senão a revogação seria parcial.
 */
export const USER_PREFERENCE_FIELDS = [
  'socialFeed',
  'socialVisibility',
  'analytics',
  'spotifyArtistsVisible',
  'spotifyTopArtistVisible',
  'spotifyWindowVisible',
] as const

export type UserPreferenceField = (typeof USER_PREFERENCE_FIELDS)[number]
