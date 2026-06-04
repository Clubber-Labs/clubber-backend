import type { FastifyReply, FastifyRequest } from 'fastify'
import type { CreateConsentBody, UpdateConsentBody } from './consent.schema'
import {
  createConsent,
  exportConsentData,
  getAuditLog,
  getConsent,
  revokeAllConsents,
  updateConsent,
} from './consent.service'

function extractMeta(req: FastifyRequest) {
  const forwarded = ((req.headers['x-forwarded-for'] as string | undefined) ?? '')
    .split(',')[0]
    ?.trim() || null
  return {
    ipAddress: forwarded ?? req.socket?.remoteAddress ?? null,
    userAgent: req.headers['user-agent'],
  }
}

export async function getConsentHandler(req: FastifyRequest, reply: FastifyReply) {
  const record = await getConsent(req.user.sub)
  if (!record) return reply.status(404).send({ message: 'Consentimento não encontrado.' })
  return reply.send(record)
}

export async function createConsentHandler(req: FastifyRequest, reply: FastifyReply) {
  const consent = await createConsent(req.user.sub, req.body as CreateConsentBody, extractMeta(req))
  req.log.info({ userId: req.user.sub }, 'Consent granted')
  return reply.status(201).send(consent)
}

export async function updateConsentHandler(req: FastifyRequest, reply: FastifyReply) {
  const consent = await updateConsent(req.user.sub, req.body as UpdateConsentBody, extractMeta(req))
  req.log.info({ userId: req.user.sub }, 'Consent updated')
  return reply.send(consent)
}

export async function revokeConsentHandler(req: FastifyRequest, reply: FastifyReply) {
  await revokeAllConsents(req.user.sub, extractMeta(req))
  req.log.info({ userId: req.user.sub }, 'All consents revoked')
  return reply.send({ message: 'Todos os consentimentos opcionais foram revogados.' })
}

export async function exportConsentHandler(req: FastifyRequest, reply: FastifyReply) {
  const data = await exportConsentData(req.user.sub, extractMeta(req))
  req.log.info({ userId: req.user.sub }, 'Consent data exported (LGPD Art. 18, V)')
  return reply
    .header('Content-Disposition', 'attachment; filename="meus-dados-lgpd.json"')
    .send(data)
}

export async function getAuditLogHandler(req: FastifyRequest, reply: FastifyReply) {
  const logs = await getAuditLog(req.user.sub)
  return reply.send({ logs })
}
