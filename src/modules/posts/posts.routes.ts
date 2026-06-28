import type { FastifyInstance } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { rateLimit } from '../../lib/rate-limit'
import {
  deletePost,
  getPosts,
  postPost,
  uploadPostImageHandler,
} from './posts.controller'
import {
  createPostSchema,
  eventIdParamSchema,
  paginationSchema,
  postParamSchema,
} from './posts.schema'

export async function postsRoutes(app: FastifyInstance) {
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  const api = app.withTypeProvider<ZodTypeProvider>()

  // Criar post no evento (apenas participantes)
  api.post(
    '/events/:eventId/posts',
    {
      schema: { params: eventIdParamSchema, body: createPostSchema },
      onRequest: [app.authenticate],
    },
    postPost,
  )

  api.get(
    '/events/:eventId/posts',
    {
      schema: { params: eventIdParamSchema, querystring: paginationSchema },
      onRequest: [app.authenticate],
    },
    getPosts,
  )

  // Deletar próprio post
  api.delete(
    '/events/:eventId/posts/:postId',
    {
      schema: { params: postParamSchema },
      onRequest: [app.authenticate],
    },
    deletePost,
  )

  // Enviar imagem para o post (multipart, uma por request — apenas o autor)
  api.post(
    '/events/:eventId/posts/:postId/images',
    {
      schema: { params: postParamSchema },
      onRequest: [app.authenticate],
      // Upload processa a imagem com sharp inline (CPU/memória); sem teto vira
      // vetor de exaustão. Teto generoso p/ bursts de upload legítimos.
      config: { rateLimit: rateLimit(20) },
    },
    uploadPostImageHandler,
  )
}
