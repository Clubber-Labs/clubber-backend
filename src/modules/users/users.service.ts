import { hash } from 'bcryptjs'
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

export async function listUsers() {
  return findAllUsers()
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