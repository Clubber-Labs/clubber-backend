import { prisma } from '../../lib/prisma'

const authorSelect = {
  id: true,
  name: true,
  lastname: true,
  username: true,
  avatarUrl: true,
} as const

export async function createComment(
  authorId: string,
  content: string,
  target: { eventId: string } | { postId: string },
) {
  return prisma.comment.create({
    data: { authorId, content, ...target },
    include: { author: { select: authorSelect } },
  })
}

export async function findCommentById(commentId: string) {
  return prisma.comment.findUnique({ where: { id: commentId } })
}

export async function findCommentsByEvent(
  eventId: string,
  limit: number,
  cursor?: string,
) {
  return prisma.comment.findMany({
    where: { eventId },
    take: limit,
    ...(cursor && { skip: 1, cursor: { id: cursor } }),
    orderBy: { createdAt: 'asc' },
    include: { author: { select: authorSelect } },
  })
}

export async function findCommentsByPost(
  postId: string,
  limit: number,
  cursor?: string,
) {
  return prisma.comment.findMany({
    where: { postId },
    take: limit,
    ...(cursor && { skip: 1, cursor: { id: cursor } }),
    orderBy: { createdAt: 'asc' },
    include: { author: { select: authorSelect } },
  })
}

export async function deleteComment(commentId: string) {
  return prisma.comment.delete({ where: { id: commentId } })
}
