import type { FastifyInstance } from 'fastify'
import {
  deleteFollowHandler,
  getFollowers,
  getFollowing,
  postApproveFollow,
  postFollow,
  postRejectFollow,
} from './follows.controller'
import {
  followActionSchema,
  followUserIdParamSchema,
  followUserSchema,
  paginationSchema,
} from './follows.schema'

export async function followsRoutes(app: FastifyInstance) {
  app.post(
    '/follows',
    { schema: { body: followUserSchema }, onRequest: [app.authenticate] },
    postFollow,
  )

  app.post(
    '/follows/approve',
    { schema: { body: followActionSchema }, onRequest: [app.authenticate] },
    postApproveFollow,
  )

  app.post(
    '/follows/reject',
    { schema: { body: followActionSchema }, onRequest: [app.authenticate] },
    postRejectFollow,
  )

  app.delete(
    '/follows/unfollow',
    { schema: { body: followUserSchema }, onRequest: [app.authenticate] },
    deleteFollowHandler,
  )

  app.get(
    '/follows/:id/followers',
    {
      schema: {
        params: followUserIdParamSchema,
        querystring: paginationSchema,
      },
    },
    getFollowers,
  )

  app.get(
    '/follows/:id/following',
    {
      schema: {
        params: followUserIdParamSchema,
        querystring: paginationSchema,
      },
    },
    getFollowing,
  )
}
