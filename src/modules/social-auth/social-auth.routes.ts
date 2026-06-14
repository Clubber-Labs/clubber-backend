import type { FastifyInstance } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { rateLimit } from '../../lib/rate-limit'
import { postSocialLogin } from './social-auth.controller'
import { socialLoginBodySchema } from './social-auth.schema'

export async function socialAuthRoutes(app: FastifyInstance) {
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  const api = app.withTypeProvider<ZodTypeProvider>()

  api.post(
    '/auth/social',
    {
      schema: { body: socialLoginBodySchema },
      config: { rateLimit: rateLimit(20) },
    },
    postSocialLogin,
  )
}
