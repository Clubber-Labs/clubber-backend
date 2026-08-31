import { cache } from '../../lib/cache'
import { AppError } from '../../lib/errors/app-error'
import { ensureEventAccess } from '../event-invites/event-invites.access'
import { notifyFromActor } from '../notifications/notifications.service'
import { findPostById } from '../posts/posts.repository'
import {
  createComment,
  deleteComment,
  findCommentById,
  findCommentDetail,
  findCommentsByEvent,
  findCommentsByPost,
  findRepliesByComment,
  type NormalizedComment,
} from './comments.repository'
import type { CreateCommentBody } from './comments.schema'

/**
 * Valida o pai de uma resposta: tem que existir, pertencer ao MESMO alvo
 * (evento ou post) e ser raiz. Sem a checagem de alvo, um parentId de outro
 * post ancoraria a resposta numa thread que a listagem daquele post nunca
 * mostraria — a resposta sumiria das duas telas.
 */
async function resolveParentComment(
  parentId: string,
  target: { eventId: string } | { postId: string },
) {
  const parent = await findCommentById(parentId)
  const scopeId = 'eventId' in target ? target.eventId : target.postId
  const parentScopeId = 'eventId' in target ? parent?.eventId : parent?.postId
  if (!parent || parentScopeId !== scopeId) {
    throw new AppError(404, 'PARENT_COMMENT_NOT_FOUND')
  }
  // Thread rasa de 1 nível: responder uma resposta viraria árvore sem fim, que
  // nem a listagem nem a UI do app sabem renderizar.
  if (parent.parentId) {
    throw new AppError(400, 'COMMENT_REPLY_DEPTH')
  }
  return parent
}

/**
 * Resolve o eventId associado a um comentário, seja diretamente (comentário
 * de evento) ou via post (comentário de post → eventId do post).
 *
 * Compartilhado entre comments, reactions e reports pra manter o tratamento
 * de borda (faltando eventId/postId, post inexistente) consistente em todo
 * fluxo que depende de "qual evento esse comentário pertence?".
 */
export async function resolveCommentEventId(comment: {
  eventId: string | null
  postId: string | null
}): Promise<string> {
  if (comment.eventId) return comment.eventId
  if (!comment.postId) {
    throw new AppError(500, 'COMMENT_SCOPE_MISSING')
  }
  const post = await findPostById(comment.postId)
  if (!post) {
    throw new AppError(404, 'POST_NOT_FOUND')
  }
  return post.eventId
}

export async function addCommentToEvent(
  authorId: string,
  eventId: string,
  body: CreateCommentBody,
) {
  const event = await ensureEventAccess(eventId, authorId)
  const parent = body.parentId
    ? await resolveParentComment(body.parentId, { eventId })
    : null
  const comment = await createComment(authorId, body.content, {
    eventId,
    parentId: body.parentId,
  })
  if (event.isPublic) {
    await cache.invalidate('events:public:*')
  }
  // Resposta avisa quem foi respondido, não o dono do evento: para o autor do
  // evento a thread já rendeu a notificação do comentário raiz.
  await notifyFromActor({
    recipientId: parent ? parent.authorId : event.authorId,
    actorId: authorId,
    type: parent ? 'COMMENT_REPLY' : 'EVENT_COMMENT',
    eventId,
    commentId: comment.id,
  })
  return comment
}

export async function addCommentToPost(
  authorId: string,
  postId: string,
  body: CreateCommentBody,
) {
  const post = await findPostById(postId)
  if (!post) {
    throw new AppError(404, 'POST_NOT_FOUND')
  }
  await ensureEventAccess(post.eventId, authorId)
  const parent = body.parentId
    ? await resolveParentComment(body.parentId, { postId })
    : null
  const comment = await createComment(authorId, body.content, {
    postId,
    parentId: body.parentId,
  })
  await notifyFromActor({
    recipientId: parent ? parent.authorId : post.authorId,
    actorId: authorId,
    type: parent ? 'COMMENT_REPLY' : 'POST_COMMENT',
    // eventId junto: post não tem tela própria no app — o deep-link abre o evento.
    eventId: post.eventId,
    postId,
    commentId: comment.id,
  })
  return comment
}

function page(rows: NormalizedComment[], limit: number) {
  return {
    data: rows,
    nextCursor: rows.length === limit ? rows[rows.length - 1].id : null,
  }
}

export async function listEventComments(
  eventId: string,
  requesterId: string,
  limit: number,
  cursor?: string,
) {
  await ensureEventAccess(eventId, requesterId)
  return page(
    await findCommentsByEvent(eventId, limit, cursor, requesterId),
    limit,
  )
}

export async function listPostComments(
  postId: string,
  requesterId: string,
  limit: number,
  cursor?: string,
) {
  const post = await findPostById(postId)
  if (!post) {
    throw new AppError(404, 'POST_NOT_FOUND')
  }
  await ensureEventAccess(post.eventId, requesterId)
  return page(
    await findCommentsByPost(postId, limit, cursor, requesterId),
    limit,
  )
}

export async function listEventCommentReplies(
  eventId: string,
  commentId: string,
  requesterId: string,
  limit: number,
  cursor?: string,
) {
  await ensureEventAccess(eventId, requesterId)
  const parent = await findCommentById(commentId)
  if (!parent || parent.eventId !== eventId) {
    throw new AppError(404, 'COMMENT_NOT_FOUND')
  }
  return page(
    await findRepliesByComment(commentId, limit, cursor, requesterId),
    limit,
  )
}

export async function listPostCommentReplies(
  postId: string,
  commentId: string,
  requesterId: string,
  limit: number,
  cursor?: string,
) {
  const post = await findPostById(postId)
  if (!post) {
    throw new AppError(404, 'POST_NOT_FOUND')
  }
  await ensureEventAccess(post.eventId, requesterId)
  const parent = await findCommentById(commentId)
  if (!parent || parent.postId !== postId) {
    throw new AppError(404, 'COMMENT_NOT_FOUND')
  }
  return page(
    await findRepliesByComment(commentId, limit, cursor, requesterId),
    limit,
  )
}

/**
 * Um comentário pelo id. Existe para o deep-link da notificação COMMENT_REPLY,
 * que carrega o id da RESPOSTA: o `parentId` daqui é o que diz qual thread
 * abrir, já que a listagem só devolve raízes.
 */
export async function getEventComment(
  eventId: string,
  commentId: string,
  requesterId: string,
) {
  await ensureEventAccess(eventId, requesterId)
  const comment = await findCommentDetail(commentId, requesterId)
  if (!comment || comment.eventId !== eventId) {
    throw new AppError(404, 'COMMENT_NOT_FOUND')
  }
  return comment
}

export async function getPostComment(
  postId: string,
  commentId: string,
  requesterId: string,
) {
  const post = await findPostById(postId)
  if (!post) {
    throw new AppError(404, 'POST_NOT_FOUND')
  }
  await ensureEventAccess(post.eventId, requesterId)
  const comment = await findCommentDetail(commentId, requesterId)
  if (!comment || comment.postId !== postId) {
    throw new AppError(404, 'COMMENT_NOT_FOUND')
  }
  return comment
}

export async function removeComment(
  commentId: string,
  requesterId: string,
  scopeId: string,
) {
  const comment = await findCommentById(commentId)
  if (!comment) {
    throw new AppError(404, 'COMMENT_NOT_FOUND')
  }

  const belongsToScope =
    comment.eventId === scopeId || comment.postId === scopeId
  if (!belongsToScope) {
    throw new AppError(404, 'COMMENT_NOT_FOUND')
  }

  const eventId = await resolveCommentEventId(comment)
  const event = await ensureEventAccess(eventId, requesterId)

  if (comment.authorId !== requesterId) {
    throw new AppError(403, 'NOT_COMMENT_AUTHOR')
  }

  const result = await deleteComment(commentId)
  if (comment.eventId && event.isPublic) {
    await cache.invalidate('events:public:*')
  }
  return result
}
