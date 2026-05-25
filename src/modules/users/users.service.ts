import { hash } from 'bcryptjs'
import { deleteUploaded, uploadAvatar } from '../../lib/uploads'
import {
  findFollow,
  findFollowStatusesByFollower,
} from '../follows/follows.repository'
import {
  createUser,
  deleteUser,
  findAllUsers,
  findUserAvatarKey,
  findUserByEmail,
  findUserById,
  findUserByUsername,
  searchUsers as searchUsersRepo,
  updateUser,
} from './users.repository'
import type {
  CreateUserBody,
  SearchUsersQuery,
  UpdateUserBody,
} from './users.schema'

type Logger = { error: (msg: string) => void }

export async function listUsers(limit: number, cursor?: string) {
  const users = await findAllUsers(limit, cursor)
  const nextCursor = users.length === limit ? users[users.length - 1].id : null
  return { data: users, nextCursor }
}

export async function searchUsers(
  { q, limit, cursor }: SearchUsersQuery,
  viewerId: string,
) {
  const users = await searchUsersRepo(q, limit, cursor)
  const nextCursor = users.length === limit ? users[users.length - 1].id : null

  const otherIds = users.filter((u) => u.id !== viewerId).map((u) => u.id)
  const statuses = await findFollowStatusesByFollower(viewerId, otherIds)

  const data = users.map((u) => {
    const isSelf = u.id === viewerId
    const followStatus = isSelf ? null : (statuses.get(u.id) ?? null)

    // Privacy gate: privado sem follow ACCEPTED só expõe card mínimo,
    // sem bio/counts/createdAt. O próprio viewer sempre vê seu shape completo.
    const hidePrivate = u.isPrivate && !isSelf && followStatus !== 'ACCEPTED'
    if (hidePrivate) {
      return {
        id: u.id,
        username: u.username,
        name: u.name,
        lastname: u.lastname,
        avatarUrl: u.avatarUrl,
        isPrivate: true as const,
        followStatus,
      }
    }

    return { ...u, followStatus }
  })

  return { data, nextCursor }
}

export async function getUserById(id: string, viewerId?: string) {
  const user = await findUserById(id)
  if (!user) throw { statusCode: 404, message: 'Usuário não encontrado' }

  const { _count, ...rest } = user

  const follow =
    viewerId && viewerId !== id ? await findFollow(viewerId, id) : null
  const followStatus = follow?.status ?? null

  return { ...rest, eventsCount: _count.events, followStatus }
}

export async function getMe(userId: string) {
  const user = await findUserById(userId)
  if (!user) throw { statusCode: 404, message: 'Usuário não encontrado' }
  const { _count, ...rest } = user
  return { ...rest, eventsCount: _count.events }
}

export async function registerUser(data: CreateUserBody) {
  const emailExists = await findUserByEmail(data.email)
  const usernameExists = await findUserByUsername(data.username)

  if (emailExists) {
    throw {
      statusCode: 409,
      message: 'Este e-mail já está cadastrado em outra conta.',
    }
  }
  if (usernameExists) {
    throw {
      statusCode: 409,
      message: 'Este nome de usuário já está em uso.',
    }
  }

  const passwordHash = await hash(data.password, 10)

  return createUser({ ...data, password: passwordHash })
}

export async function editUser(id: string, data: UpdateUserBody) {
  await getUserById(id)

  if (data.username) {
    const existing = await findUserByUsername(data.username)
    if (existing && existing.id !== id) {
      throw {
        statusCode: 409,
        message: 'Este nome de usuário já está em uso.',
      }
    }
  }

  return updateUser(id, data)
}

export async function removeUser(id: string, logger: Logger) {
  const current = await findUserAvatarKey(id)
  if (!current) {
    throw { statusCode: 404, message: 'Usuário não encontrado' }
  }
  await deleteUser(id)
  if (current.avatarKey) {
    await deleteUploaded(current.avatarKey, logger)
  }
}

export async function changeUserAvatar(
  userId: string,
  buffer: Buffer,
  logger: Logger,
) {
  const current = await findUserAvatarKey(userId)
  if (!current) {
    throw { statusCode: 404, message: 'Usuário não encontrado' }
  }

  const uploaded = await uploadAvatar(buffer, userId)

  try {
    const updated = await updateUser(userId, {
      avatarUrl: uploaded.url,
      avatarKey: uploaded.key,
    })
    if (current.avatarKey) {
      await deleteUploaded(current.avatarKey, logger)
    }
    return updated
  } catch (err) {
    await deleteUploaded(uploaded.key, logger)
    throw err
  }
}
