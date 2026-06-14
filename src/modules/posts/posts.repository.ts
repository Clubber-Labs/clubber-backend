import type { Prisma } from '@prisma/client'
import { visibleAuthorWhere } from '../../lib/account-visibility'
import { prisma } from '../../lib/prisma'

const authorSelect = {
  id: true,
  name: true,
  lastname: true,
  username: true,
  avatarUrl: true,
} as const

// `key` fica de fora: identificador interno do provider, só usado para deletar.
const postImageSelect = {
  id: true,
  url: true,
  format: true,
  size: true,
  order: true,
} as const

const postImagesInclude = {
  orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  select: postImageSelect,
} satisfies Prisma.Post$imagesArgs

export async function createPost(
  authorId: string,
  eventId: string,
  content: string,
) {
  return prisma.post.create({
    data: { authorId, eventId, content },
    include: {
      author: { select: authorSelect },
      images: postImagesInclude,
    },
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
    where: { eventId, author: visibleAuthorWhere() },
    take: limit,
    ...(cursor && { skip: 1, cursor: { id: cursor } }),
    orderBy: { createdAt: 'desc' },
    include: {
      author: { select: authorSelect },
      images: postImagesInclude,
      _count: { select: { comments: true, reactions: true } },
    },
  })
}

export async function deletePost(postId: string) {
  return prisma.post.delete({ where: { id: postId } })
}

export async function countPostImages(postId: string) {
  return prisma.postImage.count({ where: { postId } })
}

export async function createPostImage(
  postId: string,
  data: Omit<Prisma.PostImageUncheckedCreateInput, 'postId' | 'order'>,
) {
  const agg = await prisma.postImage.aggregate({
    where: { postId },
    _max: { order: true },
  })
  const nextOrder = (agg._max.order ?? -1) + 1
  return prisma.postImage.create({
    data: { ...data, postId, order: nextOrder },
    select: postImageSelect,
  })
}

export async function findPostImageKeys(postId: string) {
  return prisma.postImage.findMany({
    where: { postId },
    select: { key: true },
  })
}
