import type { FastifyReply, FastifyRequest } from 'fastify'
import { env } from '../../lib/env'
import { renderInviteLanding, renderUnavailableLanding } from './share.landing'
import type { ShareTokenParam } from './share.schema'
import {
  buildAppleAppSiteAssociation,
  buildAssetLinks,
  getInviteLandingData,
} from './share.service'

export async function getInviteLanding(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { token } = request.params as ShareTokenParam
  const data = await getInviteLandingData(token)

  // Conteúdo de evento privado atrás de token revogável: sem cache
  // intermediário — revogar o link tem efeito imediato também na web.
  reply.header('cache-control', 'no-store')
  reply.type('text/html; charset=utf-8')
  if (data.kind === 'ok') {
    return reply.send(renderInviteLanding(data))
  }

  const status = data.kind === 'not_found' ? 404 : 410
  const reason = data.kind === 'not_found' ? 'not_found' : 'gone'
  return reply
    .status(status)
    .send(
      renderUnavailableLanding(reason, env.PLAY_STORE_URL, env.APP_STORE_URL),
    )
}

// Conteúdo estático de config: 1h de cache segura os scrapers automáticos de
// Apple/Google sem atrasar de forma relevante uma troca de fingerprint.
const WELL_KNOWN_CACHE = 'public, max-age=3600'

export async function getAppleAppSiteAssociation(
  _request: FastifyRequest,
  reply: FastifyReply,
) {
  return reply
    .header('cache-control', WELL_KNOWN_CACHE)
    .type('application/json')
    .send(buildAppleAppSiteAssociation())
}

export async function getAssetLinks(
  _request: FastifyRequest,
  reply: FastifyReply,
) {
  return reply
    .header('cache-control', WELL_KNOWN_CACHE)
    .type('application/json')
    .send(buildAssetLinks())
}
