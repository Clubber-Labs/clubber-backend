import type { FastifyReply, FastifyRequest } from 'fastify'
import type {
  CreateReportBody,
  ReportCommentParams,
  ReportEventParams,
  ReportMessageParams,
} from './reports.schema'
import { reportComment, reportEvent, reportMessage } from './reports.service'

export async function postEventReport(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { eventId } = request.params as ReportEventParams
  const body = request.body as CreateReportBody
  const report = await reportEvent(body, request.user.sub, eventId)
  return reply.status(201).send(report)
}

export async function postCommentReport(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { commentId } = request.params as ReportCommentParams
  const body = request.body as CreateReportBody
  const report = await reportComment(body, request.user.sub, commentId)
  return reply.status(201).send(report)
}

export async function postMessageReport(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { messageId } = request.params as ReportMessageParams
  const body = request.body as CreateReportBody
  const report = await reportMessage(body, request.user.sub, messageId)
  return reply.status(201).send(report)
}
