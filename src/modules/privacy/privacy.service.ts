import { createHash } from 'node:crypto'
import type { PrivacyConsentSource, PrivacyRequestType } from '@prisma/client'
import {
  PRIVACY_PURPOSES,
  REQUIRED_PRIVACY_PURPOSES,
  getPrivacyConfig,
} from './privacy.config'
import {
  type ConsentInput,
  type PrivacyPurposeKey,
  privacyPurposeKeys,
} from './privacy.schema'
import {
  createPrivacyRequest,
  findUserConsents,
  hasGrantedConsent,
  upsertUserConsents,
} from './privacy.repository'

export type ConsentRequestContext = {
  source: PrivacyConsentSource
  ip?: string
  userAgent?: string
  metadata?: Record<string, unknown>
}

export function listConsentConfig() {
  return getPrivacyConfig()
}

function hashIp(ip?: string) {
  if (!ip) return undefined
  return createHash('sha256').update(ip).digest('hex')
}

function dedupeConsents(consents: ConsentInput[]) {
  const byKey = new Map<PrivacyPurposeKey, ConsentInput>()
  for (const consent of consents) byKey.set(consent.purposeKey, consent)
  return [...byKey.values()]
}

export function buildInitialConsentState(consents: ConsentInput[]) {
  const provided = new Map(
    dedupeConsents(consents).map((consent) => [consent.purposeKey, consent]),
  )

  for (const required of REQUIRED_PRIVACY_PURPOSES) {
    if (provided.get(required.key)?.granted !== true) {
      throw {
        statusCode: 400,
        message:
          'É necessário aceitar os Termos de Uso e a Política de Privacidade.',
      }
    }
  }

  return PRIVACY_PURPOSES.map((purpose) => ({
    purposeKey: purpose.key,
    granted: provided.get(purpose.key)?.granted ?? purpose.defaultGranted,
  }))
}

export async function setUserConsents(
  userId: string,
  consents: ConsentInput[],
  context: ConsentRequestContext,
) {
  const unique = dedupeConsents(consents)
  const requiredKeys = new Set(
    REQUIRED_PRIVACY_PURPOSES.map((purpose) => purpose.key),
  )
  for (const consent of unique) {
    if (requiredKeys.has(consent.purposeKey) && !consent.granted) {
      throw {
        statusCode: 400,
        message:
          'O consentimento obrigatório de termos e política não pode ser revogado por este endpoint.',
      }
    }
  }

  await upsertUserConsents(userId, unique, {
    source: context.source,
    ipHash: hashIp(context.ip),
    userAgent: context.userAgent,
    metadata: context.metadata,
  })

  return getUserConsentState(userId)
}

export async function createInitialUserConsents(
  userId: string,
  consents: ConsentInput[],
  context: Omit<ConsentRequestContext, 'source'>,
) {
  const initial = buildInitialConsentState(consents)
  return setUserConsents(userId, initial, {
    ...context,
    source: 'REGISTRATION',
  })
}

export async function getUserConsentState(userId: string) {
  const rows = await findUserConsents(userId)
  const byPurpose = new Map(rows.map((row) => [row.purposeKey, row]))

  return {
    ...getPrivacyConfig(),
    consents: PRIVACY_PURPOSES.map((purpose) => {
      const row = byPurpose.get(purpose.key)
      return {
        ...purpose,
        granted: row?.granted ?? purpose.defaultGranted,
        policyVersion: row?.policyVersion ?? null,
        termsVersion: row?.termsVersion ?? null,
        updatedAt: row?.updatedAt ?? null,
        revokedAt: row?.revokedAt ?? null,
      }
    }),
  }
}

export async function userHasConsent(
  userId: string,
  purposeKey: PrivacyPurposeKey,
) {
  if (!privacyPurposeKeys.includes(purposeKey)) return false
  return hasGrantedConsent(userId, purposeKey)
}

export async function openPrivacyRequest(
  userId: string,
  type: PrivacyRequestType,
  notes?: string,
) {
  return createPrivacyRequest(userId, type, notes)
}
