import { prisma } from '../../lib/prisma'
import type { CreateUserBody } from './users.schema'

export async function findUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: {
      email,
    },
  })
}

export async function findUserByUsername(username: string) {
  return prisma.user.findUnique({
    where: {
      username,
    },
  })
}

export async function createUser(
  data: Omit<CreateUserBody, 'password'> & {
    password: string
  },
) {
  return prisma.user.create({ data })
}
