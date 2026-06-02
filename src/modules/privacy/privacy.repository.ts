import type {
  PrivacyConsentAction,
  PrivacyConsentSource,
  PrivacyRequestType,
  Prisma,
} from '@prisma/client'
import { prisma } from '../../lib/prisma'
import {
  PRIVACY_POLICY_VERSION,
  PRIVACY_TERMS_VERSION,
  type ConsentInput,
  type PrivacyPurposeKey,
} from './privacy.schema'

export type ConsentAuditContext = {
  source: PrivacyConsentSource
  ipHash?: string
  userAgent?: string
  metadata?: Record<string, unknown>
}

export async function findUserConsents(userId: string) {
  return prisma.userPrivacyConsent.findMany({
    where: { userId },
    orderBy: { purposeKey: 'asc' },
  })
}

export async function findUserConsent(
  userId: string,
  purposeKey: PrivacyPurposeKey,
) {
  return prisma.userPrivacyConsent.findUnique({
    where: { userId_purposeKey: { userId, purposeKey } },
  })
}

export async function hasGrantedConsent(
  userId: string,
  purposeKey: PrivacyPurposeKey,
) {
  const consent = await findUserConsent(userId, purposeKey)
  return consent?.granted === true
}

export async function upsertUserConsents(
  userId: string,
  consents: ConsentInput[],
  context: ConsentAuditContext,
) {
  return prisma.$transaction(async (tx) => {
    const results = []
    for (const consent of consents) {
      const current = await tx.userPrivacyConsent.findUnique({
        where: {
          userId_purposeKey: { userId, purposeKey: consent.purposeKey },
        },
      })

      const action: PrivacyConsentAction =
        current?.granted === true && !consent.granted
          ? 'REVOKED'
          : consent.granted && current?.granted !== true
            ? 'GRANTED'
            : 'UPDATED'

      const row = await tx.userPrivacyConsent.upsert({
        where: {
          userId_purposeKey: { userId, purposeKey: consent.purposeKey },
        },
        create: {
          userId,
          purposeKey: consent.purposeKey,
          granted: consent.granted,
          policyVersion: PRIVACY_POLICY_VERSION,
          termsVersion:
            consent.purposeKey === 'terms_privacy_required'
              ? PRIVACY_TERMS_VERSION
              : null,
          source: context.source,
          revokedAt: consent.granted ? null : new Date(),
        },
        update: {
          granted: consent.granted,
          policyVersion: PRIVACY_POLICY_VERSION,
          termsVersion:
            consent.purposeKey === 'terms_privacy_required'
              ? PRIVACY_TERMS_VERSION
              : null,
          source: context.source,
          revokedAt: consent.granted ? null : new Date(),
        },
      })

      await tx.privacyConsentAuditLog.create({
        data: {
          userId,
          purposeKey: consent.purposeKey,
          action,
          granted: consent.granted,
          policyVersion: PRIVACY_POLICY_VERSION,
          termsVersion:
            consent.purposeKey === 'terms_privacy_required'
              ? PRIVACY_TERMS_VERSION
              : null,
          source: context.source,
          ipHash: context.ipHash,
          userAgent: context.userAgent,
          metadata: context.metadata
            ? (context.metadata as Prisma.InputJsonObject)
            : undefined,
        },
      })

      results.push(row)
    }
    return results
  })
}

export async function createPrivacyRequest(
  userId: string,
  type: PrivacyRequestType,
  notes?: string,
) {
  return prisma.privacyRequest.create({
    data: { userId, type, notes },
  })
}
