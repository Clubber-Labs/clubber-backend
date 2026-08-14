import type { FastifyInstance } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { rateLimit } from '../../lib/rate-limit'
import {
  exportConsentHandler,
  getAuditLogHandler,
  getConsentHandler,
  revokeConsentHandler,
  updateConsentHandler,
} from './consent.controller'
import {
  auditQuerySchema,
  auditResponseSchema,
  consentResponseSchema,
  exportResponseSchema,
  revokeConsentResponseSchema,
  updateConsentSchema,
} from './consent.schema'

export async function consentRoutes(app: FastifyInstance) {
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  const api = app.withTypeProvider<ZodTypeProvider>()

  // #6: schema.response filtra ipAddress/userAgent do objeto Prisma antes de serializar
  api.get(
    '/consent',
    {
      schema: { response: { 200: consentResponseSchema } },
      onRequest: [app.authenticate],
      // #8: Rate limit — leitura mais permissiva
      config: { rateLimit: rateLimit(60) },
    },
    getConsentHandler,
  )

  api.patch(
    '/consent',
    {
      schema: {
        body: updateConsentSchema,
        response: { 200: consentResponseSchema },
      },
      onRequest: [app.authenticate],
      config: { rateLimit: rateLimit(30) },
    },
    updateConsentHandler,
  )

  // revoga todos os consentimentos opcionais (LGPD Art. 8 §5)
  api.delete(
    '/consent',
    {
      schema: { response: { 200: revokeConsentResponseSchema } },
      onRequest: [app.authenticate],
      config: { rateLimit: rateLimit(10) },
    },
    revokeConsentHandler,
  )

  // portabilidade de dados (LGPD Art. 18, V)
  // #6: exportResponseSchema também exclui ipAddress/userAgent do currentConsent e history
  api.get(
    '/consent/export',
    {
      schema: { response: { 200: exportResponseSchema } },
      onRequest: [app.authenticate],
      // #8: Operação pesada — limitar strictamente
      config: { rateLimit: rateLimit(5) },
    },
    exportConsentHandler,
  )

  api.get(
    '/consent/audit',
    {
      schema: {
        querystring: auditQuerySchema,
        response: { 200: auditResponseSchema },
      },
      onRequest: [app.authenticate],
      config: { rateLimit: rateLimit(30) },
    },
    getAuditLogHandler,
  )
}
