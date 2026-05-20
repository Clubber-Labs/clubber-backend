import type { FastifyInstance } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import {
  deleteReport,
  getReportById,
  getReports,
  patchReport,
  postCommentReport,
  postEventReport,
  postUserReport,
} from './reports.controller'
import {
  createReportSchema,
  listReportsQuerySchema,
  reportParamSchema,
  reportCommentParamSchema,
  reportEventParamSchema,
  reportUserParamSchema,
  resolveReportSchema,
} from './reports.schema'

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
    },
    postEventReport,
  )

  api.post(
    '/events/:eventId/reports',
    {
      schema: { params: reportEventParamSchema, body: createReportSchema },
      onRequest: [app.authenticate],
    },
    postEventReport,
  )

  api.post(
    '/comments/:commentId/report',
    {
      schema: { params: reportCommentParamSchema, body: createReportSchema },
      onRequest: [app.authenticate],
    },
    postCommentReport,
  )

  api.post(
    '/comments/:commentId/reports',
    {
      schema: { params: reportCommentParamSchema, body: createReportSchema },
      onRequest: [app.authenticate],
    },
    postCommentReport,
  )

  api.post(
    '/users/:userId/report',
    {
      schema: { params: reportUserParamSchema, body: createReportSchema },
      onRequest: [app.authenticate],
    },
    postUserReport,
  )

  api.post(
    '/users/:userId/reports',
    {
      schema: { params: reportUserParamSchema, body: createReportSchema },
      onRequest: [app.authenticate],
    },
    postUserReport,
  )
}
