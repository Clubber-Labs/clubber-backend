import type { FastifyInstance } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { postCommentReport, postEventReport } from './reports.controller'
import {
  createReportSchema,
  reportCommentParamSchema,
  reportEventParamSchema,
} from './reports.schema'

export async function reportsRoutes(app: FastifyInstance) {
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  const api = app.withTypeProvider<ZodTypeProvider>()

  api.post(
    '/events/:eventId/report',
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
}
