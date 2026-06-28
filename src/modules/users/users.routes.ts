import type { FastifyInstance } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { rateLimit } from '../../lib/rate-limit'
import { getUserEvents } from '../events/events.controller'
import { userEventsQuerySchema } from '../events/events.schema'
// Preferências de usuário que vivem sob /users/me/*: os handlers ficam nos
// módulos donos da lógica (notifications/spots), mas a URL de usuário é
// registrada aqui, para coesão do roteamento /users/me/*.
import {
  updateLocationHandler,
  updateNotificationPrefsHandler,
} from '../notifications/notifications.controller'
import {
  updateLocationSchema,
  updateNotificationPrefsSchema,
} from '../notifications/notifications.schema'
import { patchSpotPrefs } from '../spots/spots.controller'
import { updateSpotPrefsSchema } from '../spots/spots.schema'
import {
  deactivateAccountHandler,
  deleteUserHandler,
  getMe,
  getUser,
  getUsers,
  postUser,
  putUser,
  reactivateAccountHandler,
  searchUsersHandler,
  uploadUserAvatar,
} from './users.controller'
import {
  createUserSchema,
  deleteAccountBodySchema,
  listUsersQuerySchema,
  searchUsersQuerySchema,
  updateUserSchema,
  userIdParamSchema,
} from './users.schema'

export async function usersRoutes(app: FastifyInstance) {
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  const api = app.withTypeProvider<ZodTypeProvider>()

  api.get('/users', { schema: { querystring: listUsersQuerySchema } }, getUsers)

  api.get('/users/me', { onRequest: [app.authenticate] }, getMe)

  api.post(
    '/users/me/deactivate',
    { onRequest: [app.authenticate] },
    deactivateAccountHandler,
  )

  api.post(
    '/users/me/reactivate',
    { onRequest: [app.authenticate] },
    reactivateAccountHandler,
  )

  // Rota estática precisa ficar antes de /users/:id pra clareza de leitura.
  // (Fastify resolve estática > paramétrica, mas a ordem documenta a intenção.)
  api.get(
    '/users/search',
    {
      schema: { querystring: searchUsersQuerySchema },
      onRequest: [app.authenticate],
      config: { rateLimit: rateLimit(30) },
    },
    searchUsersHandler,
  )

  api.get(
    '/users/:id',
    {
      schema: { params: userIdParamSchema },
      onRequest: [app.authenticateOptional],
    },
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

  api.post(
    '/users',
    {
      schema: { body: createUserSchema },
      config: { rateLimit: rateLimit(10) },
    },
    postUser,
  )

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
      schema: { params: userIdParamSchema, body: deleteAccountBodySchema },
      onRequest: [app.authenticate],
    },
    deleteUserHandler,
  )

  api.patch(
    '/users/me/avatar',
    {
      onRequest: [app.authenticate],
      // Upload processa a imagem com sharp inline (CPU/memória); sem teto vira
      // vetor de exaustão.
      config: { rateLimit: rateLimit(20) },
    },
    uploadUserAvatar,
  )

  // Preferências sob /users/me/* — handlers nos módulos donos (notifications/spots).
  api.patch(
    '/users/me/location',
    {
      schema: { body: updateLocationSchema },
      onRequest: [app.authenticate],
    },
    updateLocationHandler,
  )

  api.patch(
    '/users/me/notification-prefs',
    {
      schema: { body: updateNotificationPrefsSchema },
      onRequest: [app.authenticate],
    },
    updateNotificationPrefsHandler,
  )

  api.patch(
    '/users/me/spot-prefs',
    {
      schema: { body: updateSpotPrefsSchema },
      onRequest: [app.authenticate],
    },
    patchSpotPrefs,
  )
}
