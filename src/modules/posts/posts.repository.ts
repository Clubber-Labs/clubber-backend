import { prisma } from '../../lib/prisma'

const authorSelect = {
  id: true,
  name: true,
  lastname: true,
  username: true,
} as const

export async function createPost(
  authorId: string,
  eventId: string,
  content: string,
) {
  return prisma.post.create({
    data: { authorId, eventId, content },
    include: { author: { select: authorSelect } },
  })
}

export async function findPostById(postId: string) {
  return prisma.post.findUnique({
    where: { id: postId },
  })
}

export async function findPostsByEvent(
  eventId: string,
  limit: number,
  cursor?: string,
) {
  return prisma.post.findMany({
    where: { eventId },
    take: limit,
    ...(cursor && { skip: 1, cursor: { id: cursor } }),
    orderBy: { createdAt: 'desc' },
    include: {
      author: { select: authorSelect },
      _count: { select: { comments: true, reactions: true } },
    },
  })
}

export async function deletePost(postId: string) {
  return prisma.post.delete({ where: { id: postId } })
}
