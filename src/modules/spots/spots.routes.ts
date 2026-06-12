import type { FastifyInstance } from 'fastify'
import {
  deleteSpot,
  getMySpots,
  getSpotById,
  getSpots,
  patchSpot,
  postJoinSpot,
  postRenewSpot,
  postSpot,
  postSuggestions,
} from './spots.controller'
import {
  createSpotSchema,
  listSpotsQuerySchema,
  spotParamSchema,
  suggestionsSchema,
  updateSpotSchema,
} from './spots.schema'

export async function spotsRoutes(app: FastifyInstance) {
  app.post(
    '/spots',
    { schema: { body: createSpotSchema }, onRequest: [app.authenticate] },
    postSpot,
  )

  // Geração de sugestões (botão "gerar") — consome quota diária.
  app.post(
    '/spots/suggestions',
    { schema: { body: suggestionsSchema }, onRequest: [app.authenticate] },
    postSuggestions,
  )

  // "Meus spots": os spots ativos do próprio usuário (editar/cancelar/renovar).
  // Rota estática registrada antes de /spots/:id — o roteador do Fastify já
  // prioriza estática sobre paramétrica, mas mantemos a ordem explícita.
  app.get('/spots/mine', { onRequest: [app.authenticate] }, getMySpots)

  app.get(
    '/spots',
    {
      schema: { querystring: listSpotsQuerySchema },
      onRequest: [app.authenticateOptional],
    },
    getSpots,
  )

  app.get(
    '/spots/:id',
    {
      schema: { params: spotParamSchema },
      onRequest: [app.authenticateOptional],
    },
    getSpotById,
  )

  app.patch(
    '/spots/:id',
    {
      schema: { params: spotParamSchema, body: updateSpotSchema },
      onRequest: [app.authenticate],
    },
    patchSpot,
  )

  app.delete(
    '/spots/:id',
    { schema: { params: spotParamSchema }, onRequest: [app.authenticate] },
    deleteSpot,
  )

  // Entrar no spot = virar membro = participar do chat. POST cria a participação.
  app.post(
    '/spots/:id/members',
    { schema: { params: spotParamSchema }, onRequest: [app.authenticate] },
    postJoinSpot,
  )

  // Renovar o rolê por mais 24h (consome quota diária). Só o criador.
  app.post(
    '/spots/:id/renew',
    { schema: { params: spotParamSchema }, onRequest: [app.authenticate] },
    postRenewSpot,
  )
}
