import type { FastifyInstance } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { rateLimit } from '../../lib/rate-limit'
import {
  login,
  logout,
  logoutAll,
  postMfaDisable,
  postMfaEnable,
  postMfaSetup,
  refresh,
} from './auth.controller'
import { loginBodySchema, mfaCodeSchema, refreshBodySchema } from './auth.schema'

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

  // ── Sessão: rotação do refresh token + logout ────────────────────────────
  // /auth/refresh é público (o access já pode ter expirado) mas com rate-limit:
  // o refresh é opaco e de alta entropia, mas limitar corta brute-force/abuso.
  api.post(
    '/auth/refresh',
    {
      schema: { body: refreshBodySchema },
      config: { rateLimit: rateLimit(30) },
    },
    refresh,
  )

  // logout/logout-all exigem sessão válida (access token).
  api.post(
    '/auth/logout',
    {
      schema: { body: refreshBodySchema },
      onRequest: [app.authenticate],
      config: { rateLimit: rateLimit(30) },
    },
    logout,
  )

  api.post(
    '/auth/logout-all',
    {
      onRequest: [app.authenticate],
      config: { rateLimit: rateLimit(30) },
    },
    logoutAll,
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
