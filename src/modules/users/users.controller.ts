import type { FastifyReply, FastifyRequest } from 'fastify'
import { assertImageMimetype } from '../../lib/uploads'
import type {
  CreateUserBody,
  ListUsersQuery,
  UpdateUserBody,
  UserIdParam,
} from './users.schema'
import {
  changeUserAvatar,
  editUser,
  getMe as getMeService,
  getUserById,
  listUsers,
  registerUser,
  removeUser,
} from './users.service'

export async function getUsers(request: FastifyRequest, reply: FastifyReply) {
  const { limit, cursor } = request.query as ListUsersQuery
  const result = await listUsers(limit, cursor)
  return reply.send(result)
}

export async function getMe(request: FastifyRequest, reply: FastifyReply) {
  const user = await getMeService(request.user.sub)
  return reply.send(user)
}

export async function getUser(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as UserIdParam
  const user = await getUserById(id, request.user?.sub)
  return reply.send(user)
}

export async function postUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await registerUser(request.body as CreateUserBody)
  const token = await reply.jwtSign({ sub: user.id })
  return reply.status(201).send({ user, token })
}

export async function putUser(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as UserIdParam
  if (request.user.sub !== id)
    throw {
      statusCode: 403,
      message: 'Você não tem permissão para editar este usuário',
    }
  const user = await editUser(id, request.body as UpdateUserBody)
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
  await removeUser(id, request.log)
  return reply.status(204).send()
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
  return reply.send(user)
}
