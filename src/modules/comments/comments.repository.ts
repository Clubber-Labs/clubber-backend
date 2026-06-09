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

export function buildCommentInclude(viewerId?: string): Prisma.CommentInclude {
  return {
    author: { select: commentAuthorSelect },
    _count: { select: { reactions: true } },
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
    _count: { select: { reactions: true } }
    reactions: { select: { id: true } }
  }
}>

export type NormalizedComment = Omit<PrismaComment, 'reactions' | '_count'> & {
  reactionsCount: number
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
    userLiked: !!(viewerId && reactions?.length),
  }
}

export async function createComment(
  authorId: string,
  content: string,
  target: { eventId: string } | { postId: string },
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

export async function findCommentsByEvent(
  eventId: string,
  limit: number,
  cursor?: string,
  viewerId?: string,
): Promise<NormalizedComment[]> {
  const comments = (await prisma.comment.findMany({
    where: { eventId, author: visibleAuthorWhere() },
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
    where: { postId, author: visibleAuthorWhere() },
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
