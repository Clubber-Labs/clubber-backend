import type { FastifyInstance } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import {
  createConsentHandler,
  exportConsentHandler,
  getAuditLogHandler,
  getConsentHandler,
  revokeConsentHandler,
  updateConsentHandler,
} from './consent.controller'
import { createConsentSchema, updateConsentSchema } from './consent.schema'

export async function consentRoutes(app: FastifyInstance) {
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  const api = app.withTypeProvider<ZodTypeProvider>()

  // GET /consent — lê consentimento atual do usuário autenticado
  api.get('/consent', { onRequest: [app.authenticate] }, getConsentHandler)

  // POST /consent — cria consentimento no onboarding (primeira vez)
  api.post(
    '/consent',
    {
      schema: { body: createConsentSchema },
      onRequest: [app.authenticate],
    },
    createConsentHandler,
  )

  // PATCH /consent — atualiza campos individuais (tela de privacidade)
  api.patch(
    '/consent',
    {
      schema: { body: updateConsentSchema },
      onRequest: [app.authenticate],
    },
    updateConsentHandler,
  )

  // DELETE /consent — revoga todos os consentimentos opcionais (LGPD Art. 8 §5)
  api.delete('/consent', { onRequest: [app.authenticate] }, revokeConsentHandler)

  // GET /consent/export — portabilidade de dados (LGPD Art. 18, V)
  api.get('/consent/export', { onRequest: [app.authenticate] }, exportConsentHandler)

  // GET /consent/audit — histórico de alterações do titular
  api.get('/consent/audit', { onRequest: [app.authenticate] }, getAuditLogHandler)
}
