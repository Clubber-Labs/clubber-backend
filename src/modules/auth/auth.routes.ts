import type { FastifyInstance } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { rateLimit } from '../../lib/rate-limit'
import {
  login,
  postMfaDisable,
  postMfaEnable,
  postMfaSetup,
} from './auth.controller'
import { loginBodySchema, mfaCodeSchema } from './auth.schema'

export async function authRoutes(app: FastifyInstance) {
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  const api = app.withTypeProvider<ZodTypeProvider>()

  api.post(
    '/auth/login',
    {
      schema: { body: loginBodySchema },
      config: { rateLimit: rateLimit(10) },
    },
    login,
  )

  // ── MFA (TOTP) — só ADMIN (gating de role no service).
  // setup/enable aceitam o token de matrícula (admin logando sem MFA ainda) OU
  // um token de sessão normal. disable exige sessão plena (não o de matrícula).
  // Throttle agressivo: o código TOTP tem só 6 dígitos — sem rate limit, quem
  // detém um JWT (matrícula ou sessão) poderia brute-forçá-lo no enable/disable.
  const mfaRateLimit = { max: 5, timeWindow: '1 minute' }

  api.post(
    '/auth/mfa/setup',
    {
      onRequest: [app.authenticateMfaSetup],
      config: { rateLimit: mfaRateLimit },
    },
    postMfaSetup,
  )

  api.post(
    '/auth/mfa/enable',
    {
      schema: { body: mfaCodeSchema },
      onRequest: [app.authenticateMfaSetup],
      config: { rateLimit: mfaRateLimit },
    },
    postMfaEnable,
  )

  api.post(
    '/auth/mfa/disable',
    {
      schema: { body: mfaCodeSchema },
      onRequest: [app.authenticate],
      config: { rateLimit: mfaRateLimit },
    },
    postMfaDisable,
  )
}
