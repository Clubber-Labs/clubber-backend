import type { ReportStatus } from '@prisma/client'
import { cache } from '../../lib/cache'
import { AppError } from '../../lib/errors/app-error'
import { logger } from '../../lib/logger'
import { deleteChatMedia, deleteUploaded } from '../../lib/uploads'
import {
  findMessageAttachments,
  softDeleteMessage,
} from '../chat/chat.repository'
import { deleteComment } from '../comments/comments.repository'
import { resolveCommentEventId } from '../comments/comments.service'
import { ensureEventAccess } from '../event-invites/event-invites.access'
import { deleteEvent, findEventImageKeys } from '../events/events.repository'
import { deletePost, findPostImageKeys } from '../posts/posts.repository'
import { banUser, suspendUser, unsuspendUser } from '../users/users.service'
import { findRetainedMediaKeys } from './report-evidence.repository'
import { createMessageReportWithEvidence } from './report-evidence.service'
import { assertReportAdmin } from './reports.access'
import {
  createCommentReport,
  createEventReport,
  createPostReport,
  createUserReport,
  deleteReportById,
  findActiveConversationParticipant,
  findCommentById,
  findExistingCommentReport,
  findExistingEventReport,
  findExistingMessageReport,
  findExistingPostReport,
  findExistingUserReport,
  findMessageById,
  findReportById,
  findReportPostById,
  findReports,
  findReportTargetUserById,
  updateReportResolution,
} from './reports.repository'
import type {
  CreateReportBody,
  ListReportsQuery,
  ModerateUserBody,
  ResolveReportBody,
} from './reports.schema'

// Estados em que a moderação já agiu com base na denúncia. RESOLVED_INVALID e
// REVIEWED ficam de fora de propósito: ali ela concluiu que não havia o que
// fazer.
const RESOLVED_WITH_ACTION: ReportStatus[] = [
  'RESOLVED_REMOVED',
  'RESOLVED_SUSPENDED',
  'RESOLVED_BANNED',
]

/**
 * Troca o objeto `evidence` por um booleano: o painel só precisa saber se há
 * prova para oferecer o botão, e devolver o id sugeriria que ele serve para
 * alguma coisa — o endpoint auditado é chaveado pelo reportId.
 */
function shapeReport<T extends { evidence: { id: string } | null }>(
  report: T,
): Omit<T, 'evidence'> & { hasEvidence: boolean } {
  const { evidence, ...rest } = report
  return { ...rest, hasEvidence: evidence !== null }
}

export async function reportEvent(
  data: CreateReportBody,
  reporterId: string,
  eventId: string,
) {
  const event = await ensureEventAccess(eventId, reporterId)

  if (event.authorId === reporterId) {
    throw new AppError(400, 'SELF_REPORT')
  }

  const existing = await findExistingEventReport(reporterId, eventId)
  if (existing) {
    throw new AppError(409, 'REPORT_ALREADY_OPEN')
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
    throw new AppError(404, 'COMMENT_NOT_FOUND')
  }

  const parentEventId = await resolveCommentEventId(comment)
  await ensureEventAccess(parentEventId, reporterId)

  if (comment.authorId === reporterId) {
    throw new AppError(400, 'SELF_REPORT')
  }

  const existing = await findExistingCommentReport(reporterId, commentId)
  if (existing) {
    throw new AppError(409, 'REPORT_ALREADY_OPEN')
  }

  return createCommentReport(data, reporterId, commentId)
}

export async function reportPost(
  data: CreateReportBody,
  reporterId: string,
  postId: string,
) {
  const post = await findReportPostById(postId)
  if (!post) {
    throw new AppError(404, 'POST_NOT_FOUND')
  }

  await ensureEventAccess(post.eventId, reporterId)

  if (post.authorId === reporterId) {
    throw new AppError(400, 'SELF_REPORT')
  }

  const existing = await findExistingPostReport(reporterId, postId)
  if (existing) {
    throw new AppError(409, 'REPORT_ALREADY_OPEN')
  }

  return createPostReport(data, reporterId, postId)
}

export async function reportMessage(
  data: CreateReportBody,
  reporterId: string,
  messageId: string,
) {
  const message = await findMessageById(messageId)
  if (!message) {
    throw new AppError(404, 'MESSAGE_NOT_FOUND')
  }

  const participant = await findActiveConversationParticipant(
    message.conversationId,
    reporterId,
  )
  if (!participant) {
    throw new AppError(403, 'NOT_CONVERSATION_MEMBER')
  }

  if (message.senderId === reporterId) {
    throw new AppError(400, 'SELF_REPORT')
  }

  const existing = await findExistingMessageReport(reporterId, messageId)
  if (existing) {
    throw new AppError(409, 'REPORT_ALREADY_OPEN')
  }

  // Depois de TODOS os guards: capturar antes deles gravaria prova de denúncia
  // que nem chega a existir. A denúncia e a prova nascem na mesma transação.
  return createMessageReportWithEvidence(data, reporterId, message)
}

export async function reportUser(
  data: CreateReportBody,
  reporterId: string,
  targetUserId: string,
) {
  const targetUser = await findReportTargetUserById(targetUserId)
  if (!targetUser) {
    throw new AppError(404, 'USER_NOT_FOUND')
  }

  if (targetUserId === reporterId) {
    throw new AppError(400, 'SELF_REPORT')
  }

  const existing = await findExistingUserReport(reporterId, targetUserId)
  if (existing) {
    throw new AppError(409, 'REPORT_ALREADY_OPEN')
  }

  return createUserReport(data, reporterId, targetUserId)
}

export async function listReports(
  query: ListReportsQuery,
  requesterId: string,
) {
  await assertReportAdmin(requesterId)
  const reports = await findReports(query)
  const hasNextPage = reports.length > query.limit
  const data = hasNextPage ? reports.slice(0, query.limit) : reports
  const nextCursor = hasNextPage ? data[data.length - 1]?.id : null

  return { data: data.map(shapeReport), nextCursor }
}

export async function getReport(reportId: string, requesterId: string) {
  await assertReportAdmin(requesterId)
  const report = await findReportById(reportId)
  if (!report) {
    throw new AppError(404, 'REPORT_NOT_FOUND')
  }

  return shapeReport(report)
}

export async function resolveReport(
  reportId: string,
  requesterId: string,
  data: ResolveReportBody,
) {
  await assertReportAdmin(requesterId)
  const report = await findReportById(reportId)
  if (!report) {
    throw new AppError(404, 'REPORT_NOT_FOUND')
  }

  return shapeReport(await updateReportResolution(reportId, requesterId, data))
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

async function removeReportedPost(postId: string) {
  const images = await findPostImageKeys(postId)
  await Promise.all(images.map((img) => deleteUploaded(img.key, logger)))
  await deletePost(postId)
}

async function removeReportedMessage(reportId: string, messageId: string) {
  const message = await findMessageById(messageId)
  if (!message) {
    throw new AppError(404, 'MESSAGE_NOT_FOUND')
  }

  if (!message.deletedAt) {
    await softDeleteMessage(messageId)
  }

  // O texto não precisa de cuidado: o soft-delete só marca deletedAt e o
  // contentCipher fica. A mídia, sim — apagar do storage é irreversível, e
  // "remover o conteúdo" não pode destruir a prova que justificou a remoção.
  const retained = new Set(await findRetainedMediaKeys(reportId))
  const attachments = await findMessageAttachments(messageId)
  await Promise.all(
    attachments.flatMap((a) => {
      // Poster de vídeo é objeto próprio no storage (key separada do vídeo).
      const keys = a.thumbnailKey ? [a.key, a.thumbnailKey] : [a.key]
      return keys
        .filter((key) => !retained.has(key))
        .map((key) => deleteChatMedia(key, logger))
    }),
  )
}

export async function removeReportTarget(
  reportId: string,
  requesterId: string,
) {
  await assertReportAdmin(requesterId)
  const report = await findReportById(reportId)
  if (!report) {
    throw new AppError(404, 'REPORT_NOT_FOUND')
  }

  if (
    report.status === 'RESOLVED_REMOVED' &&
    !report.eventId &&
    !report.commentId &&
    !report.messageId &&
    !report.postId
  ) {
    return report
  }

  if (report.targetUserId) {
    throw new AppError(400, 'INVALID_REPORT_ACTION')
  }

  if (
    !report.eventId &&
    !report.commentId &&
    !report.messageId &&
    !report.postId
  ) {
    throw new AppError(409, 'REPORTED_CONTENT_GONE')
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
    await removeReportedMessage(reportId, report.messageId)
  } else if (report.postId) {
    await removeReportedPost(report.postId)
  }

  // Re-fetch para refletir as FKs nulas após cascade SetNull da deleção de conteúdo
  const updated = await findReportById(reportId)
  if (!updated) throw new AppError(404, 'REPORT_NOT_FOUND')
  return shapeReport(updated)
}

export async function removeReport(reportId: string, requesterId: string) {
  await assertReportAdmin(requesterId)
  const report = await findReportById(reportId)
  if (!report) {
    throw new AppError(404, 'REPORT_NOT_FOUND')
  }

  // A evidência morre por cascade junto com a denúncia. Tudo bem enquanto a
  // denúncia não gerou ação — spam e engano têm que poder ser apagados. Mas
  // depois que a moderação AGIU com base nela, apagar deixaria a ação de pé sem
  // a prova que a sustenta, que é exatamente o que a captura existe para
  // evitar. A guarda é condicionada à evidência: denúncia sem prova
  // (evento, post, usuário) segue apagável como antes.
  if (report.evidence && RESOLVED_WITH_ACTION.includes(report.status)) {
    throw new AppError(409, 'REPORT_BACKS_ACTIVE_PUNISHMENT')
  }

  // A mídia retida só existia por causa desta evidência; sem ela, ninguém mais
  // aponta para esses objetos.
  const retained = await deleteReportById(reportId)
  await Promise.all(retained.map((key) => deleteChatMedia(key, logger)))
}

/**
 * Pune o usuário alvo de uma denúncia (suspende ou bane) e fecha a denúncia.
 * É o "fluxo próprio" que o removeReportTarget delega para usuário. A punição
 * (suspendUser/banUser) e a resolução são feitas em sequência; o estado da
 * conta é a fonte da verdade, então uma falha na resolução não desfaz a punição
 * (o moderador reabre a denúncia se preciso).
 */
export async function moderateReportedUser(
  reportId: string,
  requesterId: string,
  body: ModerateUserBody,
) {
  await assertReportAdmin(requesterId)
  const report = await findReportById(reportId)
  if (!report) {
    throw new AppError(404, 'REPORT_NOT_FOUND')
  }
  if (!report.targetUserId) {
    throw new AppError(400, 'REPORT_NOT_ABOUT_USER')
  }

  if (body.action === 'SUSPEND') {
    // União discriminada: neste branch `body.days` é number (sem cast).
    await suspendUser(report.targetUserId, requesterId, body.days, body.reason)
  } else {
    await banUser(report.targetUserId, requesterId, body.reason)
  }

  const note =
    body.reason ??
    (body.action === 'SUSPEND'
      ? `Usuário suspenso por ${body.days} dia(s) pela moderação`
      : 'Usuário banido pela moderação')

  return shapeReport(
    await updateReportResolution(reportId, requesterId, {
      status:
        body.action === 'SUSPEND' ? 'RESOLVED_SUSPENDED' : 'RESOLVED_BANNED',
      resolutionNote: note,
    }),
  )
}

/** Levanta a punição (suspensão/ban) de um usuário — não atado a denúncia. */
export async function liftUserModeration(userId: string, requesterId: string) {
  await assertReportAdmin(requesterId)
  return unsuspendUser(userId)
}
