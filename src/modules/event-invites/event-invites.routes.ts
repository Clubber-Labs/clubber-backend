import type { FastifyInstance } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { getInvites, postInvite } from './event-invites.controller'
import {
  eventInviteParamSchema,
  inviteUsersBodySchema,
} from './event-invites.schema'

export async function eventInvitesRoutes(app: FastifyInstance) {
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  const api = app.withTypeProvider<ZodTypeProvider>()

  // Convidar seguidores (todos ou selecionados) para um evento privado
  api.post(
    '/events/:eventId/invites',
    {
      schema: { params: eventInviteParamSchema, body: inviteUsersBodySchema },
      onRequest: [app.authenticate],
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
