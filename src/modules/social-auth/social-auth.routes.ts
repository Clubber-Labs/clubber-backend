import type { FastifyInstance } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
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
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
        },
      },
    },
    postSocialLogin,
  )
}
