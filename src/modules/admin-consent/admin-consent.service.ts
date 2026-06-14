import {
  findConsentAuditLogs,
  findUserById,
  findUserRoleById,
  getConsentAuditStats,
} from './admin-consent.repository'
import type { AdminConsentAuditQuery } from './admin-consent.schema'

async function assertAdmin(userId: string) {
  const user = await findUserRoleById(userId)
  if (user?.role !== 'ADMIN') {
    throw {
      statusCode: 403,
      message: 'Apenas administradores podem acessar este recurso',
    }
  }
}

function buildAuditPage(
  rows: Awaited<ReturnType<typeof findConsentAuditLogs>>,
  limit: number,
) {
  const hasMore = rows.length > limit
  const page = rows.slice(0, limit)

  const data = page.map((log) => ({
    id: log.id,
    userId: log.userId,
    userName: `${log.user.name} ${log.user.lastname}`,
    action: log.action,
    timestamp: log.createdAt.toISOString(),
    ipAddress: log.ipAddress ?? null,
    metadata: {
      changedFields: log.changedFields,
      consentVersion: log.consentVersion,
    },
  }))

  const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null

  return { data, nextCursor }
}

export async function listAuditLogs(
  actingUserId: string,
  query: AdminConsentAuditQuery,
) {
  await assertAdmin(actingUserId)

  const rows = await findConsentAuditLogs({
    userId: query.userId,
    action: query.action,
    startDate: query.startDate,
    endDate: query.endDate,
    cursor: query.cursor,
    limit: query.limit,
  })

  return buildAuditPage(rows, query.limit)
}

export async function listUserAuditLogs(
  actingUserId: string,
  targetUserId: string,
  query: Omit<AdminConsentAuditQuery, 'userId'>,
) {
  await assertAdmin(actingUserId)

  const target = await findUserById(targetUserId)
  if (!target) {
    throw { statusCode: 404, message: 'Usuário não encontrado' }
  }

  const rows = await findConsentAuditLogs({
    userId: targetUserId,
    action: query.action,
    startDate: query.startDate,
    endDate: query.endDate,
    cursor: query.cursor,
    limit: query.limit,
  })

  return buildAuditPage(rows, query.limit)
}

export async function getConsentStats(actingUserId: string) {
  await assertAdmin(actingUserId)
  return getConsentAuditStats()
}
