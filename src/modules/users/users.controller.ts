import type { FastifyReply, FastifyRequest } from 'fastify'
import type {
  CreateUserBody,
  UpdateUserBody,
  UserIdParam,
} from './users.schema'
import {
  changeUserAvatar,
  editUser,
  getUserById,
  listUsers,
  registerUser,
  removeUser,
} from './users.service'
import { validateImageMimetype } from '../../lib/storage/validate-mimetype'

export async function getUsers(_request: FastifyRequest, reply: FastifyReply) {
  const users = await listUsers()
  return reply.send(users)
}

export async function getUser(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as UserIdParam
  const user = await getUserById(id)
  return reply.send(user)
}

export async function postUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await registerUser(request.body as CreateUserBody)
  return reply.status(201).send(user)
}

export async function putUser(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as UserIdParam
  const user = await editUser(id, request.body as UpdateUserBody)
  return reply.send(user)
}

export async function deleteUserHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as UserIdParam
  await removeUser(id)
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

  validateImageMimetype(data.mimetype)

  const fileBuffer = await data.toBuffer()
  const user = await changeUserAvatar(
    request.user.sub,
    fileBuffer,
    data.filename,
  )

  return reply.send(user)
}
