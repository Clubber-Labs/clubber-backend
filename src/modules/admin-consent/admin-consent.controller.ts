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
  request: FastifyRequest<{ Querystring: AdminConsentAuditQuery }>,
  reply: FastifyReply,
) {
  const result = await listAuditLogs(request.user.sub, request.query)
  return reply.send(result)
}

export async function getUserAuditLogsHandler(
  request: FastifyRequest<{
    Params: AdminConsentUserParam
    Querystring: Omit<AdminConsentAuditQuery, 'userId'>
  }>,
  reply: FastifyReply,
) {
  const result = await listUserAuditLogs(
    request.user.sub,
    request.params.userId,
    request.query,
  )
  return reply.send(result)
}

export async function getConsentStatsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const result = await getConsentStats(request.user.sub)
  return reply.send(result)
}
