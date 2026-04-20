import type { FastifyInstance } from 'fastify'
import { postCommentReport, postEventReport } from './reports.controller'
import { createReportSchema } from './reports.schema'

export async function reportsRoutes(app: FastifyInstance) {
  
app.post
(
    '/events/:id/report',
    { schema: { body: createReportSchema }, onRequest: [app.authenticate] },
    postEventReport,
  )

  
app.post
(
    '/comments/:id/report',
    { schema: { body: createReportSchema }, onRequest: [app.authenticate] },
    postCommentReport,
  )
} 
