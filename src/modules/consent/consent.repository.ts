import type { Prisma, TermsDocument } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import {
  ALL_CONSENT_FIELDS,
  CURRENT_CONSENT_VERSION,
  CURRENT_DOCUMENT_VERSIONS,
} from './consent.schema'

type ConsentAction = 'GRANTED' | 'UPDATED' | 'REVOKED' | 'EXPORTED'
type AuditEntry = { field: string; from: boolean | null; to: boolean }

/**
 * Fragmento de nested-create consumido pelos dois caminhos de cadastro (senha e
 * login social). Nasce no mesmo statement do `user.create`, então não existe
 * janela em que o usuário exista sem registro — é o que faz 404 no GET /consent
 * passar a significar bug em vez de estado esperado.
 */
export function buildSignupConsentData(meta: {
  ipAddress: string | null
  userAgent: string | null
}): Pick<
  Prisma.UserCreateInput,
  'consent' | 'consentLogs' | 'termsAcceptances'
> {
  const documents = Object.keys(CURRENT_DOCUMENT_VERSIONS) as TermsDocument[]

  return {
    consent: {
      create: {
        essentialAccepted: true,
        consentVersion: CURRENT_CONSENT_VERSION,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
    },
    consentLogs: {
      create: {
        action: 'GRANTED' satisfies ConsentAction,
        // Estado inicial explícito: a trilha mostra que nada foi consentido no
        // cadastro, em vez de um log vazio que não distingue disso.
        changedFields: ALL_CONSENT_FIELDS.map((field) => ({
          field,
          from: null,
          to: false,
        })),
        consentVersion: CURRENT_CONSENT_VERSION,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
    },
    termsAcceptances: {
      create: documents.map((document) => ({
        document,
        version: CURRENT_DOCUMENT_VERSIONS[document],
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      })),
    },
  }
}

export async function findConsentByUserId(userId: string) {
  return prisma.userConsent.findUnique({ where: { userId } })
}

export async function findUserPreferences(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { socialFeed: true, socialVisibility: true, analytics: true },
  })
}

export async function findTermsAcceptances(userId: string) {
  return prisma.termsAcceptance.findMany({
    where: { userId },
    orderBy: { acceptedAt: 'asc' },
    select: { document: true, version: true, acceptedAt: true },
  })
}

export async function updateConsentFields(data: {
  userId: string
  fields: Record<string, boolean>
  auditEntries: AuditEntry[]
  auditIpAddress: string | null
  auditUserAgent: string | null | undefined
  consentVersion: string
  reactivate: boolean
}) {
  const [updated] = await prisma.$transaction([
    prisma.userConsent.update({
      where: { userId: data.userId },
      // Não sobrescreve ipAddress/userAgent originais — apenas altera os campos de consentimento
      data: {
        ...data.fields,
        consentVersion: data.consentVersion,
        ...(data.reactivate ? { revokedAt: null } : {}),
      },
    }),
    prisma.consentAuditLog.create({
      data: {
        userId: data.userId,
        action: 'UPDATED' satisfies ConsentAction,
        changedFields: data.auditEntries,
        ipAddress: data.auditIpAddress,
        userAgent: data.auditUserAgent ?? null,
        consentVersion: data.consentVersion,
      },
    }),
  ])
  return updated
}

export async function revokeConsentWithAudit(data: {
  userId: string
  allFalse: Record<string, boolean>
  preferencesFalse: Record<string, boolean>
  auditEntries: AuditEntry[]
  ipAddress: string | null
  userAgent: string | null | undefined
  consentVersion: string
}) {
  await prisma.$transaction([
    prisma.userConsent.update({
      where: { userId: data.userId },
      data: { ...data.allFalse, revokedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: data.userId },
      data: data.preferencesFalse,
    }),
    prisma.consentAuditLog.create({
      data: {
        userId: data.userId,
        action: 'REVOKED' satisfies ConsentAction,
        changedFields: data.auditEntries,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent ?? null,
        consentVersion: data.consentVersion,
      },
    }),
  ])
}

/**
 * #9: Busca consentimento + logs em uma única query via include no User,
 * eliminando o Promise.all com duas round-trips separadas.
 */
export async function findConsentAndLogs(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      consent: true,
      consentLogs: {
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  return [user?.consent ?? null, user?.consentLogs ?? []] as const
}

export async function createExportAuditLog(data: {
  userId: string
  ipAddress: string | null
  userAgent: string | null | undefined
  consentVersion: string
}) {
  return prisma.consentAuditLog.create({
    data: {
      userId: data.userId,
      action: 'EXPORTED' satisfies ConsentAction,
      changedFields: [],
      ipAddress: data.ipAddress,
      userAgent: data.userAgent ?? null,
      consentVersion: data.consentVersion,
    },
  })
}

/** #2: Paginação via cursor — segue padrão de listUsers */
export async function findAuditLogsByUserId(
  userId: string,
  limit: number,
  cursor?: string,
) {
  const logs = await prisma.consentAuditLog.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })

  const hasMore = logs.length > limit
  if (hasMore) logs.pop()
  const nextCursor = hasMore ? (logs[logs.length - 1]?.id ?? null) : null

  return { logs, nextCursor }
}
