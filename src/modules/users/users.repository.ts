import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import type { CreateUserBody } from './users.schema'

const userPublicListSelect = {
  id: true,
  name: true,
  lastname: true,
  username: true,
  bio: true,
  isPrivate: true,
  followersCount: true,
  followingCount: true,
  createdAt: true,
} as const

const userProfileSelect = {
  ...userPublicListSelect,
  email: true,
  phone: true,
  birthdate: true,
} as const

export async function findAllUsers(limit: number, cursor?: string) {
  return prisma.user.findMany({
    select: userPublicListSelect,
    take: limit,
    ...(cursor && { skip: 1, cursor: { id: cursor } }),
    orderBy: { createdAt: 'desc' },
  })
}

export async function findUserById(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: userProfileSelect,
  })
}

export async function findUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: { email },
  })
}

export async function findUserByUsername(username: string) {
  return prisma.user.findUnique({
    where: { username },
  })
}

const userPublicSelect = {
  id: true,
  name: true,
  lastname: true,
  username: true,
  email: true,
  bio: true,
  isPrivate: true,
  followersCount: true,
  followingCount: true,
  birthdate: true,
  createdAt: true,
} as const

export async function createUser(
  data: Omit<CreateUserBody, 'password'> & { password: string },
) {
  return prisma.user.create({ data, select: userPublicSelect })
}

export async function updateUser(id: string, data: Prisma.UserUpdateInput) {
  return prisma.user.update({ where: { id }, data })
}

export async function deleteUser(id: string) {
  return prisma.user.delete({
    where: { id },
  })
}
