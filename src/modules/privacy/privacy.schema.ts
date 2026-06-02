import { z } from 'zod'

export const PRIVACY_POLICY_VERSION = '2026-06-02'
export const PRIVACY_TERMS_VERSION = '2026-06-02'

export const privacyPurposeKeys = [
  'terms_privacy_required',
  'location_precise_nearby',
  'location_manual_or_approx',
  'feed_social_personalization',
  'social_activity_visibility',
  'push_event_updates',
  'marketing_premium',
  'analytics_product',
  'research_feedback',
] as const

export const privacyPurposeKeySchema = z.enum(privacyPurposeKeys)
export type PrivacyPurposeKey = z.infer<typeof privacyPurposeKeySchema>

export const consentInputSchema = z.object({
  purposeKey: privacyPurposeKeySchema,
  granted: z.boolean(),
})

export const consentUpdateSchema = z.object({
  consents: z.array(consentInputSchema).min(1).max(privacyPurposeKeys.length),
})

export const privacyRequestBodySchema = z.object({
  notes: z.string().max(500).optional(),
})

export type ConsentInput = z.infer<typeof consentInputSchema>
export type ConsentUpdateBody = z.infer<typeof consentUpdateSchema>
export type PrivacyRequestBody = z.infer<typeof privacyRequestBodySchema>
