import { compare } from 'bcryptjs'
import { findUserByEmail, findUserById } from './auth.repository'
import type { LoginBody } from './auth.schema'

export async function validateLogin(data: LoginBody) {
  const user = await findUserByEmail(data.email)
  if (!user) {
    throw { statusCode: 401, message: 'Invalid credentials' }
  }

  const valid = await compare(data.password, user.password)
  if (!valid) {
    throw { statusCode: 401, message: 'Invalid credentials' }
  }

  return user
}

export async function getAuthenticatedUser(id: string) {
  const user = await findUserById(id)
  if (!user) {
    throw { statusCode: 404, message: 'User not found' }
  }

  return user
}
