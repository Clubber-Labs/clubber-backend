import type { FastifyReply, FastifyRequest } from 'fastify'
import { extractRequestMeta } from '../../lib/request-meta'
import type { AuditQuery, UpdateConsentBody } from './consent.schema'
import {
  exportConsentData,
  getAuditLog,
  getConsent,
  revokeAllConsents,
  updateConsent,
} from './consent.service'

export async function getConsentHandler(
  req: FastifyRequest,
  reply: FastifyReply,
) {
  const record = await getConsent(req.user.sub)
  return reply.send(record)
}

export async function updateConsentHandler(
  req: FastifyRequest,
  reply: FastifyReply,
) {
  const consent = await updateConsent(
    req.user.sub,
    req.body as UpdateConsentBody,
    extractRequestMeta(req),
  )
  req.log.info({ userId: req.user.sub }, 'Consent updated')
  return reply.send(consent)
}

export async function revokeConsentHandler(
  req: FastifyRequest,
  reply: FastifyReply,
) {
  await revokeAllConsents(req.user.sub, extractRequestMeta(req))
  req.log.info({ userId: req.user.sub }, 'All consents revoked')
  return reply.send({
    message: 'Todos os consentimentos opcionais foram revogados.',
  })
}

export async function exportConsentHandler(
  req: FastifyRequest,
  reply: FastifyReply,
) {
  const data = await exportConsentData(req.user.sub, extractRequestMeta(req))
  req.log.info(
    { userId: req.user.sub },
    'Consent data exported (LGPD Art. 18, V)',
  )
  return reply
    .header(
      'Content-Disposition',
      'attachment; filename="meus-dados-lgpd.json"',
    )
    .send(data)
}

export async function getAuditLogHandler(
  req: FastifyRequest,
  reply: FastifyReply,
) {
  const result = await getAuditLog(req.user.sub, req.query as AuditQuery)
  return reply.send(result)
}
