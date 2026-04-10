import { prisma } from '../../lib/prisma'
import type { CreateUserBody, UpdateUserBody } from './users.schema'

export async function findAllUsers() {
  return prisma.user.findMany({
    select: {
      id: true,
      name: true,
      lastname: true,
      username: true,
      email: true,
      bio: true,
      birthdate: true,
      createdAt: true,
    },
  })
}

export async function findUserById(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      lastname: true,
      username: true,
      email: true,
      bio: true,
      birthdate: true,
      createdAt: true,
    },
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

export async function createUser(
  data: Omit<CreateUserBody, 'password'> & {
    password: string
  },
) {
  return prisma.user.create({
     data: {
      ...data,
      birthdate: new Date(data.birthdate)
     } 
    })
}

export async function updateUser(id: string, data: UpdateUserBody) {
  return prisma.user.update({
    where: { id },
    data,
  })
}

export async function deleteUser(id: string) {
  return prisma.user.delete({
    where: { id },
  })
}
