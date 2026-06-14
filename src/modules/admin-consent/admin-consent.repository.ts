import type { ConsentAction } from '@prisma/client'
import { prisma } from '../../lib/prisma'

type AuditFilter = {
  userId?: string
  action?: ConsentAction
  startDate?: string
  endDate?: string
  cursor?: string
  limit: number
}

export async function findUserRoleById(id: string) {
  return prisma.user.findUnique({ where: { id }, select: { role: true } })
}

export async function findUserById(id: string) {
  return prisma.user.findUnique({ where: { id }, select: { id: true } })
}

export async function findConsentAuditLogs(filter: AuditFilter) {
  const { userId, action, startDate, endDate, cursor, limit } = filter

  return prisma.consentAuditLog.findMany({
    where: {
      ...(userId ? { userId } : {}),
      ...(action ? { action } : {}),
      ...((startDate || endDate) && {
        createdAt: {
          ...(startDate ? { gte: new Date(startDate) } : {}),
          ...(endDate ? { lte: new Date(endDate) } : {}),
        },
      }),
    },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: {
      user: { select: { id: true, name: true, lastname: true } },
    },
  })
}

export async function getConsentAuditStats() {
  const [actionGroups, totalActiveConsents] = await Promise.all([
    prisma.consentAuditLog.groupBy({
      by: ['action'],
      _count: { id: true },
    }),
    prisma.userConsent.count({
      where: { essentialAccepted: true, revokedAt: null },
    }),
  ])

  const dist = { GRANTED: 0, UPDATED: 0, REVOKED: 0, EXPORTED: 0 }
  for (const g of actionGroups) {
    dist[g.action] = g._count.id
  }

  return {
    totalUsersWithActiveConsent: totalActiveConsents,
    totalRevocations: dist.REVOKED,
    totalExports: dist.EXPORTED,
    actionDistribution: dist,
  }
}
