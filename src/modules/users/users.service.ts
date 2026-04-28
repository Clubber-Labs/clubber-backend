import { hash } from 'bcryptjs'
import { imageProcessorService } from '../../lib/image-processor'
import { storageService } from '../../lib/storage'
import {
  createUser,
  deleteUser,
  findAllUsers,
  findUserByEmail,
  findUserById,
  findUserByUsername,
  updateUser,
} from './users.repository'
import type { CreateUserBody, UpdateUserBody } from './users.schema'

export async function listUsers(limit: number, cursor?: string) {
  const users = await findAllUsers(limit, cursor)
  const nextCursor = users.length === limit ? users[users.length - 1].id : null
  return { data: users, nextCursor }
}

export async function getUserById(id: string) {
  const user = await findUserById(id)
  if (!user) {
    throw { statusCode: 404, message: 'Usuário não encontrado' }
  }
  return user
}

export async function registerUser(data: CreateUserBody) {
  const emailExists = await findUserByEmail(data.email)
  const usernameExists = await findUserByUsername(data.username)

  if (emailExists) {
    throw { statusCode: 409, message: 'Email já cadastrado' }
  }
  if (usernameExists) {
    throw { statusCode: 409, message: 'Nome de usuário já cadastrado' }
  }

  const passwordHash = await hash(data.password, 10)

  return createUser({
    ...data,
    password: passwordHash,
  })
}

export async function editUser(id: string, data: UpdateUserBody) {
  await getUserById(id)

  if (data.username) {
    const existing = await findUserByUsername(data.username)
    if (existing && existing.id !== id) {
      throw { statusCode: 409, message: 'Nome de usuário já cadastrado' }
    }
  }

  return updateUser(id, data)
}

export async function removeUser(id: string) {
  await getUserById(id)
  return deleteUser(id)
}

export async function changeUserAvatar(
  userId: string,
  buffer: Buffer,
  filename: string,
) {
  const user = await getUserById(userId)

  // Deletar avatar anterior do storage se existir
  if (user.avatarUrl) {
    const oldKey = `users/${userId}/${user.avatarUrl.split('/').pop()}`
    await storageService.delete(oldKey)
  }

  const processed = await imageProcessorService.processProfileAvatar(buffer)

  const uploadResult = await storageService.upload(
    {
      buffer: processed.buffer,
      filename,
      mimetype: 'image/webp',
    },
    `users/${userId}`,
  )

  return updateUser(userId, { avatarUrl: uploadResult.url })
}
