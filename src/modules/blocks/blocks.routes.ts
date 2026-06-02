import type { FastifyInstance } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { deleteBlockHandler, getBlocks, postBlock } from './blocks.controller'
import {
  blockListQuerySchema,
  blockParamSchema,
  createBlockSchema,
} from './blocks.schema'

export async function blocksRoutes(app: FastifyInstance) {
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  const api = app.withTypeProvider<ZodTypeProvider>()

  api.post(
    '/blocks',
    {
      schema: { body: createBlockSchema },
      onRequest: [app.authenticate],
    },
    postBlock,
  )

  api.get(
    '/blocks',
    {
      schema: { querystring: blockListQuerySchema },
      onRequest: [app.authenticate],
    },
    getBlocks,
  )

  api.delete(
    '/blocks/:userId',
    {
      schema: { params: blockParamSchema },
      onRequest: [app.authenticate],
    },
    deleteBlockHandler,
  )
}
