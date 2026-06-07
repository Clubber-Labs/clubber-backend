import { hash } from 'bcryptjs'
import { deleteUploaded, uploadAvatar } from '../../lib/uploads'
import { getConsentSummary } from '../consent/consent.service'
import {
  findFollow,
  findFollowStatusesByFollower,
} from '../follows/follows.repository'
import {
  createUser,
  deleteUser,
  findAllUsers,
  findOwnUserById,
  findUserAvatarKey,
  findUserByEmail,
  findUserById,
  findUserByUsername,
  searchUsers as searchUsersRepo,
  updateUser,
  updateUserWithPreferences,
} from './users.repository'
import type {
  CreateUserBody,
  SearchUsersQuery,
  UpdateUserBody,
} from './users.schema'

type Logger = { error: (msg: string) => void }

/**
 * Achata `categoryPreferences: [{ category }]` (shape do Prisma) em
 * `preferredCategories: string[]` para a resposta da API.
 */
function withPreferredCategories<
  T extends { categoryPreferences?: { category: string }[] },
>(user: T) {
  const { categoryPreferences, ...rest } = user
  return {
    ...rest,
    preferredCategories: (categoryPreferences ?? []).map((p) => p.category),
  }
}

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
    // `kind` é tag discriminante explícita pra o client distinguir as variantes
    // sem heurística (presença/ausência de campos opcionais).
    const hidePrivate = u.isPrivate && !isSelf && followStatus !== 'ACCEPTED'
    if (hidePrivate) {
      return {
        kind: 'reduced' as const,
        id: u.id,
        username: u.username,
        name: u.name,
        lastname: u.lastname,
        avatarUrl: u.avatarUrl,
        isPrivate: true as const,
        followStatus,
      }
    }

    return { kind: 'full' as const, ...u, followStatus }
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

  return {
    ...withPreferredCategories(rest),
    eventsCount: _count.events,
    followStatus,
  }
}

export async function getMe(userId: string) {
  const user = await findOwnUserById(userId)
  // Token válido cujo usuário não existe mais (ex.: conta deletada) = sessão
  // inválida → 401, sinal inequívoco para o cliente deslogar (não 404, que
  // confundiria com "recurso ausente").
  if (!user) throw { statusCode: 401, message: 'Sessão inválida' }
  const { _count, ...rest } = user
  // Paralelo: evita round-trip sequencial ao banco
  const [preferredUser, consent] = await Promise.all([
    Promise.resolve(withPreferredCategories(rest)),
    getConsentSummary(userId),
  ])
  return { ...preferredUser, eventsCount: _count.events, consent }
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

  const user = await createUser({ ...data, password: passwordHash })
  return withPreferredCategories(user)
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

  const { preferredCategories, ...rest } = data
  const updated =
    preferredCategories !== undefined
      ? await updateUserWithPreferences(id, rest, preferredCategories)
      : await updateUser(id, rest)
  return withPreferredCategories(updated)
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
    return withPreferredCategories(updated)
  } catch (err) {
    await deleteUploaded(uploaded.key, logger)
    throw err
  }
}
