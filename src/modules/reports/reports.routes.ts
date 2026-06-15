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
  postLiftUserModeration,
  postMessageReport,
  postModerateUser,
  postPostReport,
  postUserReport,
} from './reports.controller'
import {
  createReportSchema,
  listReportsQuerySchema,
  moderateUserSchema,
  reportCommentParamSchema,
  reportEventParamSchema,
  reportMessageParamSchema,
  reportParamSchema,
  reportPostParamSchema,
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

  // Moderação do usuário denunciado: suspender (com prazo) ou banir (permanente).
  api.post(
    '/reports/:id/moderate-user',
    {
      schema: { params: reportParamSchema, body: moderateUserSchema },
      onRequest: [app.authenticate],
    },
    postModerateUser,
  )

  // Levanta a punição de um usuário (não atado a denúncia).
  api.post(
    '/moderation/users/:userId/unsuspend',
    {
      schema: { params: reportUserParamSchema },
      onRequest: [app.authenticate],
    },
    postLiftUserModeration,
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
    '/posts/:postId/report',
    {
      schema: { params: reportPostParamSchema, body: createReportSchema },
      onRequest: [app.authenticate],
      config: createReportRouteConfig,
    },
    postPostReport,
  )

  api.post(
    '/posts/:postId/reports',
    {
      schema: { params: reportPostParamSchema, body: createReportSchema },
      onRequest: [app.authenticate],
      config: createReportRouteConfig,
    },
    postPostReport,
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
