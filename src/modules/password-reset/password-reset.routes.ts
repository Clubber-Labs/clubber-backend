import type { FastifyInstance } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import {
  forgotPassword,
  resetPasswordController,
} from './password-reset.controller'
import {
  forgotPasswordBodySchema,
  resetPasswordBodySchema,
} from './password-reset.schema'

export async function passwordResetRoutes(app: FastifyInstance) {
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  const api = app.withTypeProvider<ZodTypeProvider>()

  api.post(
    '/auth/forgot-password',
    {
      schema: { body: forgotPasswordBodySchema },
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute',
        },
      },
    },
    forgotPassword,
  )

  api.post(
    '/auth/reset-password',
    {
      schema: { body: resetPasswordBodySchema },
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
    },
    resetPasswordController,
  )
}
