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

export async function getAppleAppSiteAssociation(
  _request: FastifyRequest,
  reply: FastifyReply,
) {
  return reply.type('application/json').send(buildAppleAppSiteAssociation())
}

export async function getAssetLinks(
  _request: FastifyRequest,
  reply: FastifyReply,
) {
  return reply.type('application/json').send(buildAssetLinks())
}
