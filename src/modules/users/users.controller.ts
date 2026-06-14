import type { FastifyReply, FastifyRequest } from 'fastify'
import { assertImageMimetype } from '../../lib/uploads'
import { issueSession } from '../auth/auth.session'
import type {
  CreateUserBody,
  DeleteAccountBody,
  ListUsersQuery,
  SearchUsersQuery,
  UpdateUserBody,
  UserIdParam,
} from './users.schema'
import {
  changeUserAvatar,
  deactivateAccount,
  editUser,
  getMe as getMeService,
  getUserById,
  listUsers,
  reactivateAccount,
  registerUser,
  scheduleAccountDeletion,
  searchUsers,
} from './users.service'

export async function getUsers(request: FastifyRequest, reply: FastifyReply) {
  const { limit, cursor } = request.query as ListUsersQuery
  const result = await listUsers(limit, cursor)
  request.log.info(
    { userId: request.user?.sub, limit, cursor },
    'Requested user list',
  )
  return reply.send(result)
}

export async function searchUsersHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const query = request.query as SearchUsersQuery
  const result = await searchUsers(query, request.user.sub)
  request.log.info(
    {
      userId: request.user.sub,
      q: query.q,
      limit: query.limit,
      cursor: query.cursor,
    },
    'Searched users',
  )
  return reply.send(result)
}

export async function getMe(request: FastifyRequest, reply: FastifyReply) {
  const user = await getMeService(request.user.sub)
  request.log.info(
    { userId: request.user.sub },
    'User requested their own profile',
  )
  return reply.send(user)
}

export async function getUser(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as UserIdParam
  const user = await getUserById(id, request.user?.sub)
  request.log.info(
    { userId: request.user?.sub, targetUserId: id },
    'User requested profile for another user',
  )
  return reply.send(user)
}

export async function postUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await registerUser(request.body as CreateUserBody)
  const { token, refreshToken } = await issueSession(reply, user.id, {
    userAgent: request.headers['user-agent'] ?? null,
    ip: request.ip,
  })
  request.log.info({ userId: user.id }, 'User registered an account')
  return reply.status(201).send({ user, token, refreshToken })
}

export async function putUser(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as UserIdParam
  if (request.user.sub !== id)
    throw {
      statusCode: 403,
      message: 'Você não tem permissão para editar este usuário',
    }
  const user = await editUser(id, request.body as UpdateUserBody)
  request.log.info(
    { userId: request.user.sub, targetUserId: id },
    'User updated their own profile',
  )
  return reply.send(user)
}

export async function deleteUserHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as UserIdParam
  if (request.user.sub !== id)
    throw {
      statusCode: 403,
      message: 'Você não tem permissão para deletar este usuário',
    }
  const body = (request.body ?? {}) as NonNullable<DeleteAccountBody>
  const result = await scheduleAccountDeletion(id, body?.password, body?.reason)
  request.log.info(
    { userId: request.user.sub },
    'User scheduled their own account for deletion',
  )
  return reply.send(result)
}

export async function deactivateAccountHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const result = await deactivateAccount(request.user.sub)
  request.log.info(
    { userId: request.user.sub },
    'User deactivated their account',
  )
  return reply.send(result)
}

export async function reactivateAccountHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const result = await reactivateAccount(request.user.sub)
  request.log.info(
    { userId: request.user.sub },
    'User reactivated their account',
  )
  return reply.send(result)
}

export async function uploadUserAvatar(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const data = await request.file()
  if (!data) {
    throw { statusCode: 400, message: 'Nenhuma imagem foi enviada' }
  }
  assertImageMimetype(data.mimetype)

  const buffer = await data.toBuffer()
  const user = await changeUserAvatar(request.user.sub, buffer, request.log)
  request.log.info({ userId: request.user.sub }, 'User updated their avatar')
  return reply.send(user)
}
