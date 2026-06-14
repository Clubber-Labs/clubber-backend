import type { FastifyInstance } from 'fastify'
import {
  getAuditLogsHandler,
  getConsentStatsHandler,
  getUserAuditLogsHandler,
} from './admin-consent.controller'
import {
  adminConsentAuditQuerySchema,
  adminConsentAuditResponseSchema,
  adminConsentStatsSchema,
  adminConsentUserParamSchema,
  type AdminConsentAuditQuery,
  type AdminConsentUserParam,
} from './admin-consent.schema'

export async function adminConsentRoutes(app: FastifyInstance) {
  app.get<{ Querystring: AdminConsentAuditQuery }>(
    '/admin/consent/audit',
    {
      schema: {
        querystring: adminConsentAuditQuerySchema,
        response: { 200: adminConsentAuditResponseSchema },
      },
      onRequest: [app.authenticate],
    },
    getAuditLogsHandler,
  )

  app.get<{
    Params: AdminConsentUserParam
    Querystring: Omit<AdminConsentAuditQuery, 'userId'>
  }>(
    '/admin/consent/audit/:userId',
    {
      schema: {
        params: adminConsentUserParamSchema,
        querystring: adminConsentAuditQuerySchema.omit({ userId: true }),
        response: { 200: adminConsentAuditResponseSchema },
      },
      onRequest: [app.authenticate],
    },
    getUserAuditLogsHandler,
  )

  app.get(
    '/admin/consent/stats',
    {
      schema: { response: { 200: adminConsentStatsSchema } },
      onRequest: [app.authenticate],
    },
    getConsentStatsHandler,
  )
}
