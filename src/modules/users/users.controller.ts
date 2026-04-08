import type { FastifyReply, FastifyRequest } from 'fastify'
import type {
  CreateUserBody,
  UpdateUserBody,
  UserIdParam,
} from './users.schema'
import {
  editUser,
  getUserById,
  listUsers,
  registerUser,
  removeUser,
} from './users.service'

export async function getUsers(_request: FastifyRequest, reply: FastifyReply) {
  const users = await listUsers()
  return reply.send(users)
}

export async function getUser(
  request: FastifyRequest<{ Params: UserIdParam }>,
  reply: FastifyReply,
) {
  const user = await getUserById(request.params.id)
  return reply.send(user)
}

export async function postUser(
  request: FastifyRequest<{ Body: CreateUserBody }>,
  reply: FastifyReply,
) {
  const user = await registerUser(request.body)
  return reply.status(201).send(user)
}

export async function putUser(
  request: FastifyRequest<{ Params: UserIdParam; Body: UpdateUserBody }>,
  reply: FastifyReply,
) {
  const user = await editUser(request.params.id, request.body)
  return reply.send(user)
}

export async function deleteUserHandler(
  request: FastifyRequest<{ Params: UserIdParam }>,
  reply: FastifyReply,
) {
  await removeUser(request.params.id)
  return reply.status(204).send()
}