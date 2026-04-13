import type { FastifyInstance } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import {
  deleteFollow,
  deleteFollower,
  getFollowers,
  getFollowing,
  getPendingRequests,
  postApproveFollow,
  postFollow,
  postRejectFollow,
} from './follows.controller'
import {
  followParamSchema,
  followRequestParamSchema,
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
      schema: { params: followParamSchema },
      onRequest: [app.authenticate],
    },
    postFollow,
  )

  // Deixar de seguir um usuário
  api.delete(
    '/users/:userId/follow',
    {
      schema: { params: followParamSchema },
      onRequest: [app.authenticate],
    },
    deleteFollow,
  )

  // Listar seguidores de um usuário (respeita privacidade)
  api.get(
    '/users/:userId/followers',
    {
      schema: {
        params: followParamSchema,
        querystring: paginationSchema,
      },
      onRequest: [app.authenticate],
    },
    getFollowers,
  )

  // Listar quem um usuário segue (respeita privacidade)
  api.get(
    '/users/:userId/following',
    {
      schema: {
        params: followParamSchema,
        querystring: paginationSchema,
      },
      onRequest: [app.authenticate],
    },
    getFollowing,
  )

  // Remover um seguidor da própria lista
  api.delete(
    '/users/me/followers/:followerId',
    {
      schema: { params: followRequestParamSchema },
      onRequest: [app.authenticate],
    },
    deleteFollower,
  )

  // Listar solicitações de follow pendentes do usuário autenticado
  api.get(
    '/users/me/follow-requests',
    { onRequest: [app.authenticate] },
    getPendingRequests,
  )

  // Aceitar solicitação de follow
  api.post(
    '/users/me/follow-requests/:followerId/accept',
    {
      schema: { params: followRequestParamSchema },
      onRequest: [app.authenticate],
    },
    postApproveFollow,
  )

  // Rejeitar solicitação de follow
  api.delete(
    '/users/me/follow-requests/:followerId',
    {
      schema: { params: followRequestParamSchema },
      onRequest: [app.authenticate],
    },
    postRejectFollow,
  )
}