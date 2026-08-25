import type { FastifyInstance } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { rateLimit } from '../../lib/rate-limit'
import { getInvites, postInvite } from './event-invites.controller'
import {
  eventInviteParamSchema,
  inviteUsersBodySchema,
} from './event-invites.schema'

export async function eventInvitesRoutes(app: FastifyInstance) {
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  const api = app.withTypeProvider<ZodTypeProvider>()

  // Convidar usuários (todos os seguidores ou selecionados). Em evento privado
  // o convite concede acesso; em público é divulgação (push EVENT_INVITE) e
  // qualquer autenticado convida — o rate limit contém convite em massa, já que
  // uma chamada só cobre o caso legítimo de "convidar todos os seguidores".
  api.post(
    '/events/:eventId/invites',
    {
      schema: { params: eventInviteParamSchema, body: inviteUsersBodySchema },
      onRequest: [app.authenticate],
      config: { rateLimit: rateLimit(20) },
    },
    postInvite,
  )

  // Listar convidados do evento (apenas o autor)
  api.get(
    '/events/:eventId/invites',
    {
      schema: { params: eventInviteParamSchema },
      onRequest: [app.authenticate],
    },
    getInvites,
  )
}
