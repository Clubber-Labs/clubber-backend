import type { FastifyInstance } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import {
  deleteFollow,
  deleteFollowRequest,
  getFollowers,
  getFollowing,
  getFollowRequests,
  postApproveFollowRequest,
  postFollow,
} from './follows.controller'
import {
  followerIdParamSchema,
  followUserIdParamSchema,
  paginationSchema,
} from './follows.schema'

export async function followsRoutes(app: FastifyInstance) {
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  const api = app.withTypeProvider<ZodTypeProvider>()

  // Seguir um usuário
  api.post(
    '/users/:userId/follow',
    {
      schema: { params: followUserIdParamSchema },
      onRequest: [app.authenticate],
    },
    postFollow,
  )

  // Deixar de seguir um usuário
  api.delete(
    '/users/:userId/follow',
    {
      schema: { params: followUserIdParamSchema },
      onRequest: [app.authenticate],
    },
    deleteFollow,
  )

  // Listar seguidores de um usuário
  api.get(
    '/users/:userId/followers',
    {
      schema: {
        params: followUserIdParamSchema,
        querystring: paginationSchema,
      },
    },
    getFollowers,
  )

  // Listar quem um usuário segue
  api.get(
    '/users/:userId/following',
    {
      schema: {
        params: followUserIdParamSchema,
        querystring: paginationSchema,
      },
    },
    getFollowing,
  )

  // Listar solicitações de follow pendentes do usuário autenticado
  api.get(
    '/users/me/follow-requests',
    { onRequest: [app.authenticate] },
    getFollowRequests,
  )

  // Aceitar solicitação de follow
  api.post(
    '/users/me/follow-requests/:followerId/accept',
    {
      schema: { params: followerIdParamSchema },
      onRequest: [app.authenticate],
    },
    postApproveFollowRequest,
  )

  // Rejeitar solicitação de follow
  api.delete(
    '/users/me/follow-requests/:followerId',
    {
      schema: { params: followerIdParamSchema },
      onRequest: [app.authenticate],
    },
    deleteFollowRequest,
  )
}
