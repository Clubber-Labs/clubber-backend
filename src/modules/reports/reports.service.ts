import { resolveCommentEventId } from '../comments/comments.service'
import { ensureEventAccess } from '../event-invites/event-invites.access'
import {
  createCommentReport,
  createEventReport,
  createMessageReport,
  findActiveConversationParticipant,
  findCommentById,
  findExistingCommentReport,
  findExistingEventReport,
  findExistingMessageReport,
  findMessageById,
} from './reports.repository'
import type { CreateReportBody } from './reports.schema'

export async function reportEvent(
  data: CreateReportBody,
  reporterId: string,
  eventId: string,
) {
  // ensureEventAccess já carrega o evento (findEventAccess), valida o acesso
  // via invite/autor/público e retorna { authorId } — uma query só, autoridade
  // única sobre acesso a evento.
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

  // Só quem participa da conversa pode denunciar a mensagem.
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
