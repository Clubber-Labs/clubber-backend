import type { FastifyInstance } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { rateLimit } from '../../lib/rate-limit'
import {
  createConsentHandler,
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
  createConsentSchema,
  exportResponseSchema,
  revokeConsentResponseSchema,
  updateConsentSchema,
} from './consent.schema'

export async function consentRoutes(app: FastifyInstance) {
  // Mesma convenção de todos os outros módulos do projeto
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  const api = app.withTypeProvider<ZodTypeProvider>()

  // GET /consent — lê consentimento atual
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

  // POST /consent — cria consentimento no onboarding
  api.post(
    '/consent',
    {
      schema: {
        body: createConsentSchema,
        response: { 201: consentResponseSchema },
      },
      onRequest: [app.authenticate],
      // #8: Criação deve ser rara — limitar mais
      config: { rateLimit: rateLimit(10) },
    },
    createConsentHandler,
  )

  // PATCH /consent — atualiza campos individuais
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

  // DELETE /consent — revoga todos os consentimentos opcionais (LGPD Art. 8 §5)
  api.delete(
    '/consent',
    {
      schema: { response: { 200: revokeConsentResponseSchema } },
      onRequest: [app.authenticate],
      config: { rateLimit: rateLimit(10) },
    },
    revokeConsentHandler,
  )

  // GET /consent/export — portabilidade de dados (LGPD Art. 18, V)
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

  // GET /consent/audit — histórico paginado de alterações
  // #2: aceita query params limit e cursor
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
