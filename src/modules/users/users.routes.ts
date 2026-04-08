import type { FastifyInstance } from 'fastify'
import {
  deleteUserHandler,
  getUser,
  getUsers,
  postUser,
  putUser,
} from './users.controller'
import {
  createUserSchema,
  updateUserSchema,
  userIdParamSchema,
} from './users.schema'

export async function usersRoutes(app: FastifyInstance) {
  app.get('/users', getUsers)

  app.get('/users/:id', { schema: { params: userIdParamSchema } }, getUser)

  app.post('/users', { schema: { body: createUserSchema } }, postUser)

  app.put(
    '/users/:id',
    { schema: { params: userIdParamSchema, body: updateUserSchema } },
    putUser,
  )

  app.delete(
    '/users/:id',
    { schema: { params: userIdParamSchema } },
    deleteUserHandler,
  )
}
