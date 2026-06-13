import type { FastifyInstance } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { rateLimit } from '../../lib/rate-limit'
import {
  deleteReport,
  deleteReportTarget,
  getReportById,
  getReports,
  patchReport,
  postCommentReport,
  postEventReport,
  postMessageReport,
  postUserReport,
} from './reports.controller'
import {
  createReportSchema,
  listReportsQuerySchema,
  reportCommentParamSchema,
  reportEventParamSchema,
  reportMessageParamSchema,
  reportParamSchema,
  reportUserParamSchema,
  resolveReportSchema,
} from './reports.schema'

const createReportRouteConfig = {
  rateLimit: rateLimit(20),
}

export async function reportsRoutes(app: FastifyInstance) {
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  const api = app.withTypeProvider<ZodTypeProvider>()

  api.get(
    '/reports',
    {
      schema: { querystring: listReportsQuerySchema },
      onRequest: [app.authenticate],
    },
    getReports,
  )

  api.get(
    '/reports/:id',
    {
      schema: { params: reportParamSchema },
      onRequest: [app.authenticate],
    },
    getReportById,
  )

  api.patch(
    '/reports/:id',
    {
      schema: { params: reportParamSchema, body: resolveReportSchema },
      onRequest: [app.authenticate],
    },
    patchReport,
  )

  api.delete(
    '/reports/:id/target',
    {
      schema: { params: reportParamSchema },
      onRequest: [app.authenticate],
    },
    deleteReportTarget,
  )

  api.delete(
    '/reports/:id',
    {
      schema: { params: reportParamSchema },
      onRequest: [app.authenticate],
    },
    deleteReport,
  )

  api.post(
    '/events/:eventId/report',
    {
      schema: { params: reportEventParamSchema, body: createReportSchema },
      onRequest: [app.authenticate],
      config: createReportRouteConfig,
    },
    postEventReport,
  )

  api.post(
    '/events/:eventId/reports',
    {
      schema: { params: reportEventParamSchema, body: createReportSchema },
      onRequest: [app.authenticate],
      config: createReportRouteConfig,
    },
    postEventReport,
  )

  api.post(
    '/comments/:commentId/report',
    {
      schema: { params: reportCommentParamSchema, body: createReportSchema },
      onRequest: [app.authenticate],
      config: createReportRouteConfig,
    },
    postCommentReport,
  )

  api.post(
    '/comments/:commentId/reports',
    {
      schema: { params: reportCommentParamSchema, body: createReportSchema },
      onRequest: [app.authenticate],
      config: createReportRouteConfig,
    },
    postCommentReport,
  )

  api.post(
    '/messages/:messageId/report',
    {
      schema: { params: reportMessageParamSchema, body: createReportSchema },
      onRequest: [app.authenticate],
      config: createReportRouteConfig,
    },
    postMessageReport,
  )

  api.post(
    '/messages/:messageId/reports',
    {
      schema: { params: reportMessageParamSchema, body: createReportSchema },
      onRequest: [app.authenticate],
      config: createReportRouteConfig,
    },
    postMessageReport,
  )

  api.post(
    '/users/:userId/report',
    {
      schema: { params: reportUserParamSchema, body: createReportSchema },
      onRequest: [app.authenticate],
      config: createReportRouteConfig,
    },
    postUserReport,
  )

  api.post(
    '/users/:userId/reports',
    {
      schema: { params: reportUserParamSchema, body: createReportSchema },
      onRequest: [app.authenticate],
      config: createReportRouteConfig,
    },
    postUserReport,
  )
}
