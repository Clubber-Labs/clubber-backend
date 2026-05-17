import { ensureEventAccess } from '../event-invites/event-invites.access'
import { findPostById } from '../posts/posts.repository'
import {
  createCommentReport,
  createEventReport,
  findCommentById,
  findEventById,
  findExistingCommentReport,
  findExistingEventReport,
} from './reports.repository'
import type { CreateReportBody } from './reports.schema'

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

async function resolveCommentEventId(comment: {
  eventId: string | null
  postId: string | null
}): Promise<string> {
  if (comment.eventId) return comment.eventId
  if (!comment.postId) {
    throw { statusCode: 500, message: 'Comentário sem evento ou post' }
  }
  const post = await findPostById(comment.postId)
  if (!post) {
    throw { statusCode: 404, message: 'Post do comentário não encontrado' }
  }
  return post.eventId
}
