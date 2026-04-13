import type { FastifyInstance } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import {
  deleteEventComment,
  deletePostComment,
  getEventComments,
  getPostComments,
  postEventComment,
  postPostComment,
} from './comments.controller'
import {
  createCommentSchema,
  eventCommentIdParamSchema,
  eventCommentParamSchema,
  paginationSchema,
  postCommentIdParamSchema,
  postCommentParamSchema,
} from './comments.schema'

export async function commentsRoutes(app: FastifyInstance) {
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  const api = app.withTypeProvider<ZodTypeProvider>()

  // Comentários em eventos
  api.post(
    '/events/:eventId/comments',
    {
      schema: { params: eventCommentParamSchema, body: createCommentSchema },
      onRequest: [app.authenticate],
    },
    postEventComment,
  )

  api.get(
    '/events/:eventId/comments',
    {
      schema: {
        params: eventCommentParamSchema,
        querystring: paginationSchema,
      },
      onRequest: [app.authenticate],
    },
    getEventComments,
  )

  api.delete(
    '/events/:eventId/comments/:commentId',
    {
      schema: { params: eventCommentIdParamSchema },
      onRequest: [app.authenticate],
    },
    deleteEventComment,
  )

  // Comentários em posts
  api.post(
    '/posts/:postId/comments',
    {
      schema: { params: postCommentParamSchema, body: createCommentSchema },
      onRequest: [app.authenticate],
    },
    postPostComment,
  )

  api.get(
    '/posts/:postId/comments',
    {
      schema: { params: postCommentParamSchema, querystring: paginationSchema },
      onRequest: [app.authenticate],
    },
    getPostComments,
  )

  api.delete(
    '/posts/:postId/comments/:commentId',
    {
      schema: { params: postCommentIdParamSchema },
      onRequest: [app.authenticate],
    },
    deletePostComment,
  )
}
