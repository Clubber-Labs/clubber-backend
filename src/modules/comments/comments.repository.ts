import type { Prisma } from '@prisma/client'
import { visibleAuthorWhere } from '../../lib/account-visibility'
import { prisma } from '../../lib/prisma'

export const commentAuthorSelect = {
  id: true,
  name: true,
  lastname: true,
  username: true,
  avatarUrl: true,
} as const

const authorSelect = commentAuthorSelect

/**
 * O que a listagem de comentários considera visível: raiz da thread (resposta
 * sai por findRepliesByComment) e autor exibível. Os `_count.comments` de
 * evento, post e feed contam pelo MESMO predicado — contador que não concorda
 * com a lista que ele resume vira badge mentiroso.
 */
export function visibleCommentWhere(): Prisma.CommentWhereInput {
  return { parentId: null, author: visibleAuthorWhere() }
}

export function buildCommentInclude(viewerId?: string): Prisma.CommentInclude {
  return {
    author: { select: commentAuthorSelect },
    // Mesma regra do visibleCommentWhere aplicada à outra ponta da thread:
    // repliesCount tem que bater com o que GET .../replies devolve.
    _count: {
      select: {
        reactions: true,
        replies: { where: { author: visibleAuthorWhere() } },
      },
    },
    ...(viewerId && {
      reactions: {
        where: { userId: viewerId },
        select: { id: true },
        take: 1,
      },
    }),
  }
}

type PrismaComment = Prisma.CommentGetPayload<{
  include: {
    author: { select: typeof authorSelect }
    _count: { select: { reactions: true; replies: true } }
    reactions: { select: { id: true } }
  }
}>

export type NormalizedComment = Omit<PrismaComment, 'reactions' | '_count'> & {
  reactionsCount: number
  repliesCount: number
  userLiked: boolean
}

function normalizeComment(
  comment: PrismaComment,
  viewerId?: string,
): NormalizedComment {
  const { reactions, _count, ...rest } = comment
  return {
    ...rest,
    reactionsCount: _count.reactions,
    repliesCount: _count.replies,
    userLiked: !!(viewerId && reactions?.length),
  }
}

export async function createComment(
  authorId: string,
  content: string,
  target:
    | { eventId: string; parentId?: string }
    | { postId: string; parentId?: string },
  viewerId?: string,
): Promise<NormalizedComment> {
  const comment = (await prisma.comment.create({
    data: { authorId, content, ...target },
    include: buildCommentInclude(viewerId),
  })) as unknown as PrismaComment
  return normalizeComment(comment, viewerId)
}

export async function findCommentById(commentId: string) {
  return prisma.comment.findUnique({ where: { id: commentId } })
}

/**
 * Um comentário no mesmo formato da listagem — inclusive `parentId`, que é o
 * que permite sair de uma resposta para a thread dela. Filtra por autor visível
 * como a listagem e o /replies: comentário que não aparece por lá não pode
 * aparecer por aqui.
 */
export async function findCommentDetail(
  commentId: string,
  viewerId?: string,
): Promise<NormalizedComment | null> {
  const comment = (await prisma.comment.findFirst({
    where: { id: commentId, author: visibleAuthorWhere() },
    include: buildCommentInclude(viewerId),
  })) as unknown as PrismaComment | null
  return comment ? normalizeComment(comment, viewerId) : null
}

// As listagens de evento e post trazem só a raiz da thread (parentId null): as
// respostas saem por findRepliesByComment, senão apareceriam soltas na lista,
// fora do contexto do comentário que responderam.
export async function findCommentsByEvent(
  eventId: string,
  limit: number,
  cursor?: string,
  viewerId?: string,
): Promise<NormalizedComment[]> {
  const comments = (await prisma.comment.findMany({
    where: { eventId, ...visibleCommentWhere() },
    take: limit,
    ...(cursor && { skip: 1, cursor: { id: cursor } }),
    orderBy: { createdAt: 'asc' },
    include: buildCommentInclude(viewerId),
  })) as unknown as PrismaComment[]
  return comments.map((c) => normalizeComment(c, viewerId))
}

export async function findCommentsByPost(
  postId: string,
  limit: number,
  cursor?: string,
  viewerId?: string,
): Promise<NormalizedComment[]> {
  const comments = (await prisma.comment.findMany({
    where: { postId, ...visibleCommentWhere() },
    take: limit,
    ...(cursor && { skip: 1, cursor: { id: cursor } }),
    orderBy: { createdAt: 'asc' },
    include: buildCommentInclude(viewerId),
  })) as unknown as PrismaComment[]
  return comments.map((c) => normalizeComment(c, viewerId))
}

export async function findRepliesByComment(
  parentId: string,
  limit: number,
  cursor?: string,
  viewerId?: string,
): Promise<NormalizedComment[]> {
  const comments = (await prisma.comment.findMany({
    where: { parentId, author: visibleAuthorWhere() },
    take: limit,
    ...(cursor && { skip: 1, cursor: { id: cursor } }),
    orderBy: { createdAt: 'asc' },
    include: buildCommentInclude(viewerId),
  })) as unknown as PrismaComment[]
  return comments.map((c) => normalizeComment(c, viewerId))
}

export async function deleteComment(commentId: string) {
  return prisma.comment.delete({ where: { id: commentId } })
}
