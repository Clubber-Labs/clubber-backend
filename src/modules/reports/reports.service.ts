import { ensureEventAccess } from '../event-invites/event-invites.access'
import {
  createCommentReport,
  createEventReport,
  createUserReport,
  deleteReportById,
  findCommentById,
  findEventById,
  findExistingCommentReport,
  findExistingEventReport,
  findExistingUserReport,
  findReportById,
  findReports,
  findReportTargetUserById,
  findUserRoleById,
  updateReportResolution,
} from './reports.repository'
import type {
  CreateReportBody,
  ListReportsQuery,
  ResolveReportBody,
} from './reports.schema'

async function assertAdmin(userId: string) {
  const user = await findUserRoleById(userId)
  if (user?.role !== 'ADMIN') {
    throw {
      statusCode: 403,
      message: 'Apenas administradores podem gerenciar denúncias',
    }
  }
}

export async function reportEvent(
  data: CreateReportBody,
  reporterId: string,
  eventId: string,
) {
  const event = await findEventById(eventId)
  if (!event) {
    throw { statusCode: 404, message: 'Evento não encontrado' }
  }

  await ensureEventAccess(eventId, reporterId)

  if (event.authorId === reporterId) {
    throw {
      statusCode: 400,
      message: 'Não é possível denunciar o próprio conteúdo',
    }
  }

  const existing = await findExistingEventReport(reporterId, eventId)
  if (existing) {
    throw {
      statusCode: 409,
      message: 'Você já possui uma denúncia ativa para este evento',
    }
  }

  return createEventReport(data, reporterId, eventId)
}

export async function reportComment(
  data: CreateReportBody,
  reporterId: string,
  commentId: string,
) {
  const comment = await findCommentById(commentId)
  if (!comment) {
    throw { statusCode: 404, message: 'Comentário não encontrado' }
  }

  const eventId = comment.eventId ?? comment.post?.eventId
  if (!eventId) {
    throw { statusCode: 404, message: 'Evento não encontrado' }
  }
  await ensureEventAccess(eventId, reporterId)

  if (comment.authorId === reporterId) {
    throw {
      statusCode: 400,
      message: 'Não é possível denunciar o próprio conteúdo',
    }
  }

  const existing = await findExistingCommentReport(reporterId, commentId)
  if (existing) {
    throw {
      statusCode: 409,
      message: 'Você já possui uma denúncia ativa para este comentário',
    }
  }

  return createCommentReport(data, reporterId, commentId)
}

export async function reportUser(
  data: CreateReportBody,
  reporterId: string,
  targetUserId: string,
) {
  const targetUser = await findReportTargetUserById(targetUserId)
  if (!targetUser) {
    throw { statusCode: 404, message: 'Usuário não encontrado' }
  }

  if (targetUserId === reporterId) {
    throw {
      statusCode: 400,
      message: 'Não é possível denunciar o próprio usuário',
    }
  }

  const existing = await findExistingUserReport(reporterId, targetUserId)
  if (existing) {
    throw {
      statusCode: 409,
      message: 'Você já possui uma denúncia ativa para este usuário',
    }
  }

  return createUserReport(data, reporterId, targetUserId)
}

export async function listReports(
  query: ListReportsQuery,
  requesterId: string,
) {
  await assertAdmin(requesterId)
  const reports = await findReports(query)
  const hasNextPage = reports.length > query.limit
  const data = hasNextPage ? reports.slice(0, query.limit) : reports
  const nextCursor = hasNextPage ? data[data.length - 1]?.id : null

  return { data, nextCursor }
}

export async function getReport(reportId: string, requesterId: string) {
  await assertAdmin(requesterId)
  const report = await findReportById(reportId)
  if (!report) {
    throw { statusCode: 404, message: 'Denúncia não encontrada' }
  }

  return report
}

export async function resolveReport(
  reportId: string,
  requesterId: string,
  data: ResolveReportBody,
) {
  await assertAdmin(requesterId)
  const report = await findReportById(reportId)
  if (!report) {
    throw { statusCode: 404, message: 'Denúncia não encontrada' }
  }

  return updateReportResolution(reportId, requesterId, data)
}

export async function removeReport(reportId: string, requesterId: string) {
  await assertAdmin(requesterId)
  const report = await findReportById(reportId)
  if (!report) {
    throw { statusCode: 404, message: 'Denúncia não encontrada' }
  }

  await deleteReportById(reportId)
}
