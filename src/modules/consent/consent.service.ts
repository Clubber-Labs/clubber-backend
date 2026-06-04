import { prisma } from '../../lib/prisma'
import {
  ALL_CONSENT_FIELDS,
  CURRENT_CONSENT_VERSION,
  type ConsentField,
  type CreateConsentBody,
  type UpdateConsentBody,
} from './consent.schema'

type RequestMeta = { ipAddress?: string | null; userAgent?: string }
type ConsentAction = 'GRANTED' | 'UPDATED' | 'REVOKED' | 'EXPORTED'
type AuditEntry = { field: string; from: boolean | null; to: boolean }

function buildAuditEntries(
  prev: Record<string, unknown> | null,
  next: Partial<Record<string, boolean>>,
): AuditEntry[] {
  return Object.entries(next).map(([field, to]) => ({
    field,
    from: prev ? ((prev[field] as boolean) ?? null) : null,
    to: to as boolean,
  }))
}

export async function getConsent(userId: string) {
  return prisma.userConsent.findUnique({ where: { userId } })
}

export async function createConsent(
  userId: string,
  body: CreateConsentBody,
  meta: RequestMeta,
) {
  const existing = await prisma.userConsent.findUnique({ where: { userId } })
  if (existing) {
    throw { statusCode: 409, message: 'Consentimento já registrado. Use PATCH para atualizar.' }
  }

  const [consent] = await prisma.$transaction([
    prisma.userConsent.create({
      data: {
        userId,
        essentialAccepted: true,
        ...body,
        consentVersion: CURRENT_CONSENT_VERSION,
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
      },
    }),
    prisma.consentAuditLog.create({
      data: {
        userId,
        action: 'GRANTED' satisfies ConsentAction,
        changedFields: buildAuditEntries(null, body),
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
        consentVersion: CURRENT_CONSENT_VERSION,
      },
    }),
  ])

  return consent
}

export async function updateConsent(
  userId: string,
  body: UpdateConsentBody,
  meta: RequestMeta,
) {
  const existing = await prisma.userConsent.findUnique({ where: { userId } })
  if (!existing) {
    throw { statusCode: 404, message: 'Consentimento não encontrado. Use POST para criar.' }
  }

  // Nada para atualizar → retorna o estado atual sem tocar no banco
  if (Object.keys(body).length === 0) return existing

  const [updated] = await prisma.$transaction([
    prisma.userConsent.update({
      where: { userId },
      data: {
        ...body,
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
      },
    }),
    prisma.consentAuditLog.create({
      data: {
        userId,
        action: 'UPDATED' satisfies ConsentAction,
        changedFields: buildAuditEntries(existing as Record<string, unknown>, body),
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
        consentVersion: existing.consentVersion,
      },
    }),
  ])

  return updated
}

export async function revokeAllConsents(userId: string, meta: RequestMeta) {
  const existing = await prisma.userConsent.findUnique({ where: { userId } })
  if (!existing) return

  const allFalse = Object.fromEntries(
    ALL_CONSENT_FIELDS.map(f => [f, false]),
  ) as Record<ConsentField, boolean>

  await prisma.$transaction([
    prisma.userConsent.update({
      where: { userId },
      data: { ...allFalse, revokedAt: new Date() },
    }),
    prisma.consentAuditLog.create({
      data: {
        userId,
        action: 'REVOKED' satisfies ConsentAction,
        changedFields: buildAuditEntries(existing as Record<string, unknown>, allFalse),
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
        consentVersion: existing.consentVersion,
      },
    }),
  ])
}

export async function exportConsentData(userId: string, meta: RequestMeta) {
  const [consent, logs] = await Promise.all([
    prisma.userConsent.findUnique({ where: { userId } }),
    prisma.consentAuditLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    }),
  ])

  await prisma.consentAuditLog.create({
    data: {
      userId,
      action: 'EXPORTED' satisfies ConsentAction,
      changedFields: [],
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
      consentVersion: consent?.consentVersion ?? CURRENT_CONSENT_VERSION,
    },
  })

  return { exportedAt: new Date().toISOString(), currentConsent: consent, history: logs }
}

export async function getAuditLog(userId: string) {
  return prisma.consentAuditLog.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  })
}

export async function hasConsent(userId: string, field: ConsentField): Promise<boolean> {
  const record = await prisma.userConsent.findUnique({ where: { userId } })
  if (!record) return false
  return Boolean((record as Record<string, unknown>)[field])
}

/** Resumo incluído no /users/me — sem segunda chamada no app */
export async function getConsentSummary(userId: string) {
  const record = await prisma.userConsent.findUnique({ where: { userId } })
  if (!record) return { given: false, version: null, revokedAt: null }
  return {
    given: true,
    version: record.consentVersion,
    revokedAt: record.revokedAt ?? null,
  }
}
