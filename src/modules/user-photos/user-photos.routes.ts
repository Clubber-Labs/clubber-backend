import type { FastifyInstance } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { rateLimit } from '../../lib/rate-limit'
import { userIdParamSchema } from '../users/users.schema'
import {
  deleteUserPhotoHandler,
  getUserPhotos,
  postUserPhoto,
} from './user-photos.controller'
import {
  userPhotoParamSchema,
  userPhotosQuerySchema,
} from './user-photos.schema'

export async function userPhotosRoutes(app: FastifyInstance) {
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  const api = app.withTypeProvider<ZodTypeProvider>()

  // Publica uma entrada no mural: multipart com até 10 imagens + caption/eventId.
  api.post(
    '/users/me/photos',
    {
      onRequest: [app.authenticate],
      // Cada request processa até 10 imagens com sharp inline (CPU/memória);
      // sem teto vira vetor de exaustão.
      config: { rateLimit: rateLimit(10) },
    },
    postUserPhoto,
  )

  api.get(
    '/users/:id/photos',
    {
      schema: { params: userIdParamSchema, querystring: userPhotosQuerySchema },
      onRequest: [app.authenticateOptional],
    },
    getUserPhotos,
  )

  api.delete(
    '/users/me/photos/:photoId',
    {
      schema: { params: userPhotoParamSchema },
      onRequest: [app.authenticate],
    },
    deleteUserPhotoHandler,
  )
}
