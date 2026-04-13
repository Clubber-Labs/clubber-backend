import type { FastifyInstance } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import {
  deleteEventReaction,
  deletePostReaction,
  postEventReaction,
  postPostReaction,
} from './reactions.controller'
import {
  eventReactionParamSchema,
  postReactionParamSchema,
  reactionBodySchema,
} from './reactions.schema'

export async function reactionsRoutes(app: FastifyInstance) {
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  const api = app.withTypeProvider<ZodTypeProvider>()

  // Reações em eventos
  api.post(
    '/events/:eventId/reactions',
    {
      schema: { params: eventReactionParamSchema, body: reactionBodySchema },
      onRequest: [app.authenticate],
    },
    postEventReaction,
  )

  api.delete(
    '/events/:eventId/reactions',
    {
      schema: { params: eventReactionParamSchema },
      onRequest: [app.authenticate],
    },
    deleteEventReaction,
  )

  // Reações em posts
  api.post(
    '/posts/:postId/reactions',
    {
      schema: { params: postReactionParamSchema, body: reactionBodySchema },
      onRequest: [app.authenticate],
    },
    postPostReaction,
  )

  api.delete(
    '/posts/:postId/reactions',
    {
      schema: { params: postReactionParamSchema },
      onRequest: [app.authenticate],
    },
    deletePostReaction,
  )
}
