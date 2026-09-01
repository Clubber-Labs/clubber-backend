import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'

// `key` fica de fora: identificador interno do provider, só usado para deletar.
const userPhotoImageSelect = {
  id: true,
  url: true,
  format: true,
  size: true,
  width: true,
  height: true,
  order: true,
} as const

const userPhotoSelect = {
  id: true,
  caption: true,
  createdAt: true,
  // isPublic/authorId alimentam a régua de acesso ao evento no service; a
  // resposta leva só id e title.
  event: { select: { id: true, title: true, isPublic: true, authorId: true } },
  images: { orderBy: { order: 'asc' }, select: userPhotoImageSelect },
} satisfies Prisma.UserPhotoSelect

export type UserPhotoRow = Prisma.UserPhotoGetPayload<{
  select: typeof userPhotoSelect
}>

type NewUserPhotoImage = Omit<
  Prisma.UserPhotoImageUncheckedCreateInput,
  'id' | 'photoId' | 'order' | 'createdAt'
>

/** O evento e, junto, se `userId` confirmou presença ou fez check-in nele. */
export async function findEventForPhotoLink(eventId: string, userId: string) {
  return prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      authorId: true,
      attendances: {
        where: { userId, type: 'CONFIRMED' },
        select: { id: true },
      },
      checkIns: { where: { userId }, select: { id: true } },
    },
  })
}

export async function createUserPhoto(data: {
  id: string
  userId: string
  caption: string | null
  eventId: string | null
  images: NewUserPhotoImage[]
}) {
  const { images, ...photo } = data
  return prisma.userPhoto.create({
    data: {
      ...photo,
      images: { create: images.map((image, order) => ({ ...image, order })) },
    },
    select: userPhotoSelect,
  })
}

export async function findUserPhotos(
  ownerId: string,
  limit: number,
  cursor?: string,
) {
  return prisma.userPhoto.findMany({
    where: { userId: ownerId },
    take: limit,
    ...(cursor && { skip: 1, cursor: { id: cursor } }),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: userPhotoSelect,
  })
}

export async function findUserPhotoForDeletion(photoId: string) {
  return prisma.userPhoto.findUnique({
    where: { id: photoId },
    select: { userId: true, images: { select: { key: true } } },
  })
}

export async function deleteUserPhoto(photoId: string) {
  return prisma.userPhoto.delete({ where: { id: photoId } })
}

export function countUserPhotos(userId: string) {
  return prisma.userPhoto.count({ where: { userId } })
}
