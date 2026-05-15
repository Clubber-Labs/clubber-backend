import type { FastifyInstance } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { getUserEvents } from '../events/events.controller'
import { userEventsQuerySchema } from '../events/events.schema'
import {
  deleteUserHandler,
  getMe,
  getUser,
  getUsers,
  postUser,
  putUser,
  uploadUserAvatar,
} from './users.controller'
import {
  createUserSchema,
  listUsersQuerySchema,
  updateUserSchema,
  userIdParamSchema,
} from './users.schema'

export async function usersRoutes(app: FastifyInstance) {
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  const api = app.withTypeProvider<ZodTypeProvider>()

  api.get('/users', { schema: { querystring: listUsersQuerySchema } }, getUsers)

  api.get('/users/me', { onRequest: [app.authenticate] }, getMe)

  api.get(
    '/users/:id',
    { schema: { params: userIdParamSchema }, onRequest: [app.authenticateOptional] },
    getUser,
  )

  api.get(
    '/users/:id/events',
    {
      schema: {
        params: userIdParamSchema,
        querystring: userEventsQuerySchema,
      },
      onRequest: [app.authenticateOptional],
    },
    async (request, reply) => {
      const { id, ...params } = request.params as { id: string } & Record<
        string,
        unknown
      >
      return getUserEvents(
        {
          ...request,
          params: {
            ...params,
            id,
            userId: id,
          },
        },
        reply,
      )
    },
  )

  api.post('/users', { schema: { body: createUserSchema } }, postUser)

  api.put(
    '/users/:id',
    {
      schema: { params: userIdParamSchema, body: updateUserSchema },
      onRequest: [app.authenticate],
    },
    putUser,
  )

  api.delete(
    '/users/:id',
    {
      schema: { params: userIdParamSchema },
      onRequest: [app.authenticate],
    },
    deleteUserHandler,
  )

  api.patch(
    '/users/me/avatar',
    { onRequest: [app.authenticate] },
    uploadUserAvatar,
  )
}
