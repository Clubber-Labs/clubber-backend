import type { FastifyReply, FastifyRequest } from 'fastify'
import type {
  CreateReportBody,
  ListReportsQuery,
  ModerateUserBody,
  ReportCommentParams,
  ReportEventParams,
  ReportMessageParams,
  ReportParams,
  ReportPostParams,
  ReportUserParams,
  ResolveReportBody,
} from './reports.schema'
import {
  getReport,
  liftUserModeration,
  listReports,
  moderateReportedUser,
  removeReport,
  removeReportTarget,
  reportComment,
  reportEvent,
  reportMessage,
  reportPost,
  reportUser,
  resolveReport,
} from './reports.service'

export async function getReports(request: FastifyRequest, reply: FastifyReply) {
  const query = request.query as ListReportsQuery
  const reports = await listReports(query, request.user.sub)
  return reply.send(reports)
}

export async function getReportById(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as ReportParams
  const report = await getReport(id, request.user.sub)
  return reply.send(report)
}

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
  request.log.info(
    { userId: request.user.sub, commentId },
    'User reported comment',
  )
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

export async function postPostReport(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { postId } = request.params as ReportPostParams
  const body = request.body as CreateReportBody
  const report = await reportPost(body, request.user.sub, postId)
  request.log.info({ userId: request.user.sub, postId }, 'User reported post')
  return reply.status(201).send(report)
}

export async function postUserReport(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { userId } = request.params as ReportUserParams
  const body = request.body as CreateReportBody
  const report = await reportUser(body, request.user.sub, userId)
  return reply.status(201).send(report)
}

export async function patchReport(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as ReportParams
  const body = request.body as ResolveReportBody
  const report = await resolveReport(id, request.user.sub, body)
  return reply.send(report)
}

export async function deleteReport(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as ReportParams
  await removeReport(id, request.user.sub)
  return reply.status(204).send()
}

export async function deleteReportTarget(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as ReportParams
  const report = await removeReportTarget(id, request.user.sub)
  return reply.send(report)
}

export async function postModerateUser(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as ReportParams
  const body = request.body as ModerateUserBody
  const report = await moderateReportedUser(id, request.user.sub, body)
  request.log.info(
    { moderatorId: request.user.sub, reportId: id, action: body.action },
    'Moderator acted on reported user',
  )
  return reply.send(report)
}

export async function postLiftUserModeration(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { userId } = request.params as ReportUserParams
  const user = await liftUserModeration(userId, request.user.sub)
  return reply.send(user)
}
