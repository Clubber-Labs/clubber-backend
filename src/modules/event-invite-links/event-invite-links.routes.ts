import type { FastifyInstance } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { rateLimit } from '../../lib/rate-limit'
import {
  deleteInviteLink,
  getInviteLinks,
  getInvitePreview,
  postAcceptInvite,
  postInviteLink,
} from './event-invite-links.controller'
import {
  inviteLinkEventParamSchema,
  inviteLinkIdParamSchema,
  inviteTokenParamSchema,
} from './event-invite-links.schema'

export async function eventInviteLinksRoutes(app: FastifyInstance) {
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  const api = app.withTypeProvider<ZodTypeProvider>()

  // Gerar/reusar o link compartilhável do evento (apenas o autor)
  api.post(
    '/events/:eventId/invite-links',
    {
      schema: { params: inviteLinkEventParamSchema },
      onRequest: [app.authenticate],
    },
    postInviteLink,
  )

  // Listar os links do evento com contagem de usos (apenas o autor)
  api.get(
    '/events/:eventId/invite-links',
    {
      schema: { params: inviteLinkEventParamSchema },
      onRequest: [app.authenticate],
    },
    getInviteLinks,
  )

  // Revogar um link (apenas o autor)
  api.delete(
    '/events/:eventId/invite-links/:linkId',
    {
      schema: { params: inviteLinkIdParamSchema },
      onRequest: [app.authenticate],
    },
    deleteInviteLink,
  )

  // Preview público do convite — rate limit porque o token chega de fora do app
  api.get(
    '/invites/:token',
    {
      schema: { params: inviteTokenParamSchema },
      onRequest: [app.authenticateOptional],
      config: { rateLimit: rateLimit(60) },
    },
    getInvitePreview,
  )

  // Aceitar o convite (materializa o EventInvite)
  api.post(
    '/invites/:token/accept',
    {
      schema: { params: inviteTokenParamSchema },
      onRequest: [app.authenticate],
      config: { rateLimit: rateLimit(20) },
    },
    postAcceptInvite,
  )
}
