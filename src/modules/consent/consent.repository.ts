import { prisma } from '../../lib/prisma'

type ConsentAction = 'GRANTED' | 'UPDATED' | 'REVOKED' | 'EXPORTED'
type AuditEntry = { field: string; from: boolean | null; to: boolean }

export async function findConsentByUserId(userId: string) {
  return prisma.userConsent.findUnique({ where: { userId } })
}

export async function createConsentWithAudit(data: {
  userId: string
  fields: Record<string, boolean>
  consentVersion: string
  ipAddress: string | null
  userAgent: string | undefined
  /** Audit entries para o log GRANTED (todos os campos aceitos no momento da criação) */
  auditEntries: AuditEntry[]
}) {
  const [consent] = await prisma.$transaction([
    prisma.userConsent.create({
      data: {
        userId: data.userId,
        essentialAccepted: true,
        ...data.fields,
        consentVersion: data.consentVersion,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent ?? null,
      },
    }),
    prisma.consentAuditLog.create({
      data: {
        userId: data.userId,
        action: 'GRANTED' satisfies ConsentAction,
        // #3: registra os campos aceitos no momento da criação (não mais vazio)
        changedFields: data.auditEntries,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent ?? null,
        consentVersion: data.consentVersion,
      },
    }),
  ])
  return consent
}

export async function updateConsentFields(data: {
  userId: string
  fields: Record<string, boolean>
  auditEntries: AuditEntry[]
  auditIpAddress: string | null
  auditUserAgent: string | undefined
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
  auditEntries: AuditEntry[]
  ipAddress: string | null
  userAgent: string | undefined
  consentVersion: string
}) {
  await prisma.$transaction([
    prisma.userConsent.update({
      where: { userId: data.userId },
      data: { ...data.allFalse, revokedAt: new Date() },
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
  userAgent: string | undefined
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
