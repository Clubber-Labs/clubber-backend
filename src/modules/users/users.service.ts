import { hash } from 'bcryptjs'
import {
  createUser,
  findUserByEmail,
  findUserByUsername,
} from './users.repository'
import type { CreateUserBody } from './users.schema'

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

  const user = await createUser({
    ...data,
    password: passwordHash,
  })

  return user
}
