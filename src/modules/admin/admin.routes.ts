import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  deleteEventHandler,
  getReportById,
  getReports,
  patchBanUser,
  patchReport,
  patchUnbanUser,
} from './admin.controller'
import {
  AdminBanBodySchema,
  AdminListReportsQuerySchema,
  AdminResolveReportBodySchema,
} from './admin.schema'

const idParam = z.object({ id: z.string().uuid() })
type IdParam = z.infer<typeof idParam>
type AdminBanBody = z.infer<typeof AdminBanBodySchema>
type AdminResolveReportBody = z.infer<typeof AdminResolveReportBodySchema>

type AdminListReportsQuery = z.infer<typeof AdminListReportsQuerySchema>

export async function adminRoutes(app: FastifyInstance) {
  const adminHook = { onRequest: [app.authenticateAdmin] }

  app.patch<{ Params: IdParam; Body: AdminBanBody }>(
    '/admin/users/:id/ban',
    { ...adminHook, schema: { params: idParam, body: AdminBanBodySchema } },
    patchBanUser,
  )

  app.patch<{ Params: IdParam }>(
    '/admin/users/:id/unban',
    { ...adminHook, schema: { params: idParam } },
    patchUnbanUser,
  )

  app.delete<{ Params: IdParam }>(
    '/admin/events/:id',
    { ...adminHook, schema: { params: idParam } },
    deleteEventHandler,
  )

  app.get<{ Querystring: AdminListReportsQuery }>(
    '/admin/reports',
    { ...adminHook, schema: { querystring: AdminListReportsQuerySchema } },
    getReports,
  )

  app.get<{ Params: IdParam }>(
    '/admin/reports/:id',
    { ...adminHook, schema: { params: idParam } },
    getReportById,
  )

  app.patch<{ Params: IdParam; Body: AdminResolveReportBody }>(
    '/admin/reports/:id',
    { ...adminHook, schema: { params: idParam, body: AdminResolveReportBodySchema } },
    patchReport,
  )
} 