import type { FastifyReply, FastifyRequest } from 'fastify'
import type { ConsentUpdateBody, PrivacyRequestBody } from './privacy.schema'
import {
  getUserConsentState,
  listConsentConfig,
  openPrivacyRequest,
  setUserConsents,
} from './privacy.service'

function requestContext(request: FastifyRequest) {
  return {
    source: 'SETTINGS' as const,
    ip: request.ip,
    userAgent: request.headers['user-agent'],
  }
}

export async function getConsentConfig(
  _request: FastifyRequest,
  reply: FastifyReply,
) {
  return reply.send(listConsentConfig())
}

export async function getMyConsents(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const result = await getUserConsentState(request.user.sub)
  return reply.send(result)
}

export async function putMyConsents(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const body = request.body as ConsentUpdateBody
  const result = await setUserConsents(
    request.user.sub,
    body.consents,
    requestContext(request),
  )
  return reply.send(result)
}

export async function postExportRequest(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const body = request.body as PrivacyRequestBody
  const result = await openPrivacyRequest(request.user.sub, 'EXPORT', body.notes)
  return reply.status(201).send(result)
}

export async function postDeleteRequest(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const body = request.body as PrivacyRequestBody
  const result = await openPrivacyRequest(
    request.user.sub,
    'DELETE_ANONYMIZE',
    body.notes,
  )
  return reply.status(201).send(result)
}
