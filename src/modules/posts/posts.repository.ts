import type { Prisma } from '@prisma/client'
import { visibleAuthorWhere } from '../../lib/account-visibility'
import { prisma } from '../../lib/prisma'
import { visibleCommentWhere } from '../comments/comments.repository'

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
  viewerId: string,
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
      _count: {
        select: {
          comments: { where: visibleCommentWhere() },
          reactions: true,
        },
      },
      // Só a reação do viewer — vira o booleano userLiked no service.
      reactions: { where: { userId: viewerId }, select: { id: true } },
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

export async function findPostImage(postId: string, imageId: string) {
  return prisma.postImage.findFirst({ where: { id: imageId, postId } })
}

export async function findPostImageIds(postId: string) {
  const images = await prisma.postImage.findMany({
    where: { postId },
    select: { id: true },
  })
  return images.map((image) => image.id)
}

export async function findPostImages(postId: string) {
  return prisma.postImage.findMany({
    where: { postId },
    ...postImagesInclude,
  })
}

export async function deletePostImage(imageId: string) {
  return prisma.postImage.delete({ where: { id: imageId } })
}

export async function reorderPostImages(postId: string, order: string[]) {
  await prisma.$transaction(
    order.map((imageId, index) =>
      prisma.postImage.update({
        where: { id: imageId },
        data: { order: index },
      }),
    ),
  )
  return findPostImages(postId)
}

export async function findPostImageKeys(postId: string) {
  return prisma.postImage.findMany({
    where: { postId },
    select: { key: true },
  })
}
