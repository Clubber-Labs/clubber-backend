import type { FastifyReply, FastifyRequest } from 'fastify'
import type {
  CreateReportBody,
  ReportCommentParams,
  ReportEventParams,
} from './reports.schema'
import { reportComment, reportEvent } from './reports.service'

export async function postEventReport(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { eventId } = request.params as ReportEventParams
  const body = request.body as CreateReportBody
  const report = await reportEvent(body, request.user.sub, eventId)
  request.log.info({ userId: request.user.sub, eventId }, 'User reported event')
  return reply.status(201).send(report)
}

export async function postCommentReport(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { commentId } = request.params as ReportCommentParams
  const body = request.body as CreateReportBody
  const report = await reportComment(body, request.user.sub, commentId)
  request.log.info({ userId: request.user.sub, commentId }, 'User reported comment')
  return reply.status(201).send(report)
}
