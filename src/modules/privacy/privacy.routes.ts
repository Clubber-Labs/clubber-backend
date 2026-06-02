import type { FastifyInstance } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import {
  getConsentConfig,
  getMyConsents,
  postDeleteRequest,
  postExportRequest,
  putMyConsents,
} from './privacy.controller'
import {
  consentUpdateSchema,
  privacyRequestBodySchema,
} from './privacy.schema'

export async function privacyRoutes(app: FastifyInstance) {
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  const api = app.withTypeProvider<ZodTypeProvider>()

  api.get('/privacy/consents/config', getConsentConfig)

  api.get(
    '/privacy/consents/me',
    { onRequest: [app.authenticate] },
    getMyConsents,
  )

  api.put(
    '/privacy/consents/me',
    {
      schema: { body: consentUpdateSchema },
      onRequest: [app.authenticate],
    },
    putMyConsents,
  )

  api.post(
    '/privacy/requests/export',
    {
      schema: { body: privacyRequestBodySchema },
      onRequest: [app.authenticate],
    },
    postExportRequest,
  )

  api.post(
    '/privacy/requests/delete',
    {
      schema: { body: privacyRequestBodySchema },
      onRequest: [app.authenticate],
    },
    postDeleteRequest,
  )
}
