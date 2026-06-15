import type { FastifyReply, FastifyRequest } from 'fastify'
import type {
  AdminConsentAuditQuery,
  AdminConsentUserParam,
} from './admin-consent.schema'
import {
  getConsentStats,
  listAuditLogs,
  listUserAuditLogs,
} from './admin-consent.service'

export async function getAuditLogsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const query = request.query as AdminConsentAuditQuery
  const result = await listAuditLogs(request.user.sub, query)
  return reply.send(result)
}

export async function getUserAuditLogsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { userId } = request.params as AdminConsentUserParam
  const query = request.query as Omit<AdminConsentAuditQuery, 'userId'>
  const result = await listUserAuditLogs(request.user.sub, userId, query)
  return reply.send(result)
}

export async function getConsentStatsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const result = await getConsentStats(request.user.sub)
  return reply.send(result)
}
