import {
  createCommentReport,
  createEventReport,
  findCommentById,
  findEventById,
  findExistingCommentReport,
  findExistingEventReport,
} from './reports.repository'
import type { CreateReportBody } from './reports.schema'

async function ensureEventAccessForReport(event: any, reporterId: string) {
  const visibility = event?.visibility ?? event?.privacy ?? event?.access
  const isPrivate = event?.isPrivate === true || visibility === 'private'
  if (!isPrivate) {
    return
  }
  const participantIds = Array.isArray(event?.participantIds)
    ? event.participantIds
    : Array.isArray(event?.participants)
      ? event.participants
          .map((participant: any) =>
            typeof participant === 'string'
              ? participant
              : (participant?.userId ?? participant?.id),
          )
          .filter(Boolean)
      : []
  const allowedUserIds = Array.isArray(event?.allowedUserIds)
    ? event.allowedUserIds
    : []
  const hasAccess =
    event?.authorId === reporterId ||
    participantIds.includes(reporterId) ||
    allowedUserIds.includes(reporterId)
  if (!hasAccess) {
    throw { statusCode: 404, message: 'Evento não encontrado' }
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

  await ensureEventAccessForReport(event, reporterId)

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

  const eventId = comment.eventId ?? comment.postId
  if (!eventId) {
    throw { statusCode: 404, message: 'Evento não encontrado' }
  }
  await ensureEventAccessForReport(eventId, reporterId)

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
