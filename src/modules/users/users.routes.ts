import type { FastifyInstance, FastifyRequest } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { getUserEvents } from '../events/events.controller'
import { userEventsQuerySchema } from '../events/events.schema'
import {
  deleteUserHandler,
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

async function optionalAuthenticate(request: FastifyRequest) {
  try {
    await request.jwtVerify()
  } catch {
    // ignora — autenticação opcional
  }
}

export async function usersRoutes(app: FastifyInstance) {
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  const api = app.withTypeProvider<ZodTypeProvider>()

  api.get('/users', { schema: { querystring: listUsersQuerySchema } }, getUsers)

  api.get('/users/:id', { schema: { params: userIdParamSchema } }, getUser)

  api.get(
    '/users/:id/events',
    {
      schema: {
        params: userIdParamSchema,
        querystring: userEventsQuerySchema,
      },
      onRequest: [optionalAuthenticate],
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
