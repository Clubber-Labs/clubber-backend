import { cache } from '../../lib/cache'
import { logger } from '../../lib/logger'
import {
  deleteChatMedia,
  deleteUploaded,
  resourceTypeForKind,
} from '../../lib/uploads'
import {
  findMessageAttachments,
  softDeleteMessage,
} from '../chat/chat.repository'
import { deleteComment } from '../comments/comments.repository'
import { resolveCommentEventId } from '../comments/comments.service'
import { ensureEventAccess } from '../event-invites/event-invites.access'
import { deleteEvent, findEventImageKeys } from '../events/events.repository'
import {
  createCommentReport,
  createEventReport,
  createMessageReport,
  createUserReport,
  deleteReportById,
  findActiveConversationParticipant,
  findCommentById,
  findExistingCommentReport,
  findExistingEventReport,
  findExistingMessageReport,
  findExistingUserReport,
  findMessageById,
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
  const event = await ensureEventAccess(eventId, reporterId)

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

  const parentEventId = await resolveCommentEventId(comment)
  await ensureEventAccess(parentEventId, reporterId)

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

export async function reportMessage(
  data: CreateReportBody,
  reporterId: string,
  messageId: string,
) {
  const message = await findMessageById(messageId)
  if (!message) {
    throw { statusCode: 404, message: 'Mensagem não encontrada' }
  }

  const participant = await findActiveConversationParticipant(
    message.conversationId,
    reporterId,
  )
  if (!participant) {
    throw { statusCode: 403, message: 'Você não participa desta conversa' }
  }

  if (message.senderId === reporterId) {
    throw {
      statusCode: 400,
      message: 'Não é possível denunciar o próprio conteúdo',
    }
  }

  const existing = await findExistingMessageReport(reporterId, messageId)
  if (existing) {
    throw {
      statusCode: 409,
      message: 'Você já possui uma denúncia ativa para esta mensagem',
    }
  }

  return createMessageReport(data, reporterId, messageId)
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

async function removeReportedEvent(eventId: string) {
  const images = await findEventImageKeys(eventId)
  await Promise.all(images.map((img) => deleteUploaded(img.key, logger)))
  await deleteEvent(eventId)
  await cache.invalidate('events:public:*')
}

async function removeReportedComment(commentId: string) {
  await deleteComment(commentId)
  await cache.invalidate('events:public:*')
}

async function removeReportedMessage(messageId: string) {
  const message = await findMessageById(messageId)
  if (!message) {
    throw { statusCode: 404, message: 'Mensagem não encontrada' }
  }

  if (!message.deletedAt) {
    await softDeleteMessage(messageId)
  }

  const attachments = await findMessageAttachments(messageId)
  await Promise.all(
    attachments.map((a) =>
      deleteChatMedia(a.key, logger, resourceTypeForKind(a.kind)),
    ),
  )
}

export async function removeReportTarget(
  reportId: string,
  requesterId: string,
) {
  await assertAdmin(requesterId)
  const report = await findReportById(reportId)
  if (!report) {
    throw { statusCode: 404, message: 'Denúncia não encontrada' }
  }

  if (
    report.status === 'RESOLVED_REMOVED' &&
    !report.eventId &&
    !report.commentId &&
    !report.messageId
  ) {
    return report
  }

  if (report.targetUserId) {
    throw {
      statusCode: 400,
      message:
        'Remoção de usuário exige fluxo próprio de suspensão ou banimento',
    }
  }

  if (!report.eventId && !report.commentId && !report.messageId) {
    throw {
      statusCode: 409,
      message: 'O conteúdo denunciado já não está disponível',
    }
  }

  // Atualiza o status antes de excluir o conteúdo — se a exclusão falhar,
  // o trail de auditoria fica consistente (RESOLVED_REMOVED). Vazamento de
  // storage é recuperável; status PENDING sem conteúdo associado não é.
  await updateReportResolution(reportId, requesterId, {
    status: 'RESOLVED_REMOVED',
    resolutionNote: 'Conteúdo removido pela moderação',
  })

  if (report.eventId) {
    await removeReportedEvent(report.eventId)
  } else if (report.commentId) {
    await removeReportedComment(report.commentId)
  } else if (report.messageId) {
    await removeReportedMessage(report.messageId)
  }

  // Re-fetch para refletir as FKs nulas após cascade SetNull da deleção de conteúdo
  const updated = await findReportById(reportId)
  if (!updated) throw { statusCode: 404, message: 'Denúncia não encontrada' }
  return updated
}

export async function removeReport(reportId: string, requesterId: string) {
  await assertAdmin(requesterId)
  const report = await findReportById(reportId)
  if (!report) {
    throw { statusCode: 404, message: 'Denúncia não encontrada' }
  }

  await deleteReportById(reportId)
}
