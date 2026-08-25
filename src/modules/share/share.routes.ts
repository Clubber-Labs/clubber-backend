import type { FastifyInstance } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { rateLimit } from '../../lib/rate-limit'
import {
  getAppleAppSiteAssociation,
  getAssetLinks,
  getInviteLanding,
} from './share.controller'
import { shareTokenParamSchema } from './share.schema'

export async function shareRoutes(app: FastifyInstance) {
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  const api = app.withTypeProvider<ZodTypeProvider>()

  // Landing pública do convite (OG tags pra preview no WhatsApp/Instagram).
  // Generoso no rate limit: scrapers de preview batem aqui junto com pessoas.
  api.get(
    '/e/:token',
    {
      schema: { params: shareTokenParamSchema },
      config: { rateLimit: rateLimit(120) },
    },
    getInviteLanding,
  )

  // Verificação de Universal Links (iOS) e App Links (Android). Sem auth e sem
  // rate limit: Apple CDN e Google baixam esses arquivos por conta própria.
  api.get('/.well-known/apple-app-site-association', getAppleAppSiteAssociation)
  api.get('/.well-known/assetlinks.json', getAssetLinks)
}
