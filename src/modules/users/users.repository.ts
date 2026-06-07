import type { Prisma } from '@prisma/client'
import type { EventCategory } from '../../lib/event-categories'
import { prisma } from '../../lib/prisma'
import type { CreateUserBody } from './users.schema'

const userPublicListSelect = {
  id: true,
  name: true,
  lastname: true,
  username: true,
  bio: true,
  avatarUrl: true,
  isPrivate: true,
  followersCount: true,
  followingCount: true,
  createdAt: true,
} as const

const userPublicProfileSelect = {
  ...userPublicListSelect,
  categoryPreferences: { select: { category: true } },
} as const

const userPrivateProfileSelect = {
  ...userPublicProfileSelect,
  email: true,
  phone: true,
  birthdate: true,
  role: true,
} as const

export async function findAllUsers(limit: number, cursor?: string) {
  return prisma.user.findMany({
    select: userPublicListSelect,
    take: limit,
    ...(cursor && { skip: 1, cursor: { id: cursor } }),
    orderBy: { createdAt: 'desc' },
  })
}

export async function searchUsers(q: string, limit: number, cursor?: string) {
  return prisma.user.findMany({
    where: {
      OR: [
        { username: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
        { lastname: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: userPublicListSelect,
    take: limit,
    ...(cursor && { skip: 1, cursor: { id: cursor } }),
    orderBy: [{ username: 'asc' }, { id: 'asc' }],
  })
}

export async function findUserById(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: {
      ...userPublicProfileSelect,
      _count: { select: { events: true } },
    },
  })
}

export async function findOwnUserById(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: {
      ...userPrivateProfileSelect,
      _count: { select: { events: true } },
    },
  })
}

export async function findUserAvatarKey(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: { avatarKey: true },
  })
}

export async function findUserByEmail(email: string) {
  return prisma.user.findUnique({ where: { email } })
}

export async function findUserByUsername(username: string) {
  return prisma.user.findUnique({ where: { username } })
}

export async function createUser(
  data: Omit<CreateUserBody, 'password'> & { password: string | null },
) {
  const { preferredCategories, ...userData } = data
  return prisma.user.create({
    data: {
      ...userData,
      ...(preferredCategories && preferredCategories.length > 0
        ? {
            categoryPreferences: {
              create: preferredCategories.map((category) => ({ category })),
            },
          }
        : {}),
    },
    select: userPrivateProfileSelect,
  })
}

export async function updateUser(id: string, data: Prisma.UserUpdateInput) {
  return prisma.user.update({
    where: { id },
    data,
    select: userPrivateProfileSelect,
  })
}

/**
 * Atualiza o usuário e substitui suas preferências de categoria numa única
 * transação (semântica PUT: a lista enviada vira o estado completo).
 */
export async function updateUserWithPreferences(
  id: string,
  data: Prisma.UserUpdateInput,
  categories: EventCategory[],
) {
  const [, , user] = await prisma.$transaction([
    prisma.userCategoryPreference.deleteMany({ where: { userId: id } }),
    prisma.userCategoryPreference.createMany({
      data: categories.map((category) => ({ userId: id, category })),
      skipDuplicates: true,
    }),
    prisma.user.update({
      where: { id },
      data,
      select: userPrivateProfileSelect,
    }),
  ])
  return user
}

export async function deleteUser(id: string) {
  return prisma.user.delete({ where: { id } })
}
