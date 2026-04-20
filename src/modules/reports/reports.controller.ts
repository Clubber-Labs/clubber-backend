import type { FastifyReply, FastifyRequest } from 'fastify'
import type { CreateReportBody } from './reports.schema'
import { reportComment, reportEvent } from './reports.service'

export async function postEventReport(
  request: FastifyRequest<{ Params: { id: string }; Body: CreateReportBody }>,
  reply: FastifyReply,
) {
  const report = await reportEvent(request.body, request.user.sub, 
request.params.id
)
  return reply.status(201).send(report)
}

export async function postCommentReport(
  request: FastifyRequest<{ Params: { id: string }; Body: CreateReportBody }>,
  reply: FastifyReply,
) {
  const report = await reportComment(request.body, request.user.sub, 
request.params.id
)
  return reply.status(201).send(report)
} 