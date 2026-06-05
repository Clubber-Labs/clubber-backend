import { BlockList, isIP } from 'node:net'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type {
  AuditQuery,
  CreateConsentBody,
  UpdateConsentBody,
} from './consent.schema'
import {
  createConsent,
  exportConsentData,
  getAuditLog,
  getConsent,
  revokeAllConsents,
  updateConsent,
} from './consent.service'

function firstHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function normalizeIp(value: string | null | undefined) {
  const ip = value?.trim()
  if (!ip) return null

  const withoutIpv6Prefix = ip.startsWith('::ffff:') ? ip.slice(7) : ip
  return isIP(withoutIpv6Prefix) ? withoutIpv6Prefix : null
}

function trustedProxyIps() {
  return (process.env.TRUSTED_PROXIES ?? '')
    .split(',')
    .map((rule) => rule.trim())
    .filter(Boolean)
}

function ipFamily(value: string) {
  const version = isIP(value)
  if (version === 4) return 'ipv4'
  if (version === 6) return 'ipv6'
  return null
}

function isTrustedProxy(remoteIp: string, rules: string[]) {
  const remoteFamily = ipFamily(remoteIp)
  if (!remoteFamily) return false

  const blockList = new BlockList()
  for (const rule of rules) {
    const [address, prefix] = rule.split('/')
    const normalized = normalizeIp(address)
    if (!normalized || ipFamily(normalized) !== remoteFamily) continue

    if (prefix === undefined) {
      blockList.addAddress(normalized, remoteFamily)
      continue
    }

    const prefixNumber = Number(prefix)
    const maxPrefix = remoteFamily === 'ipv4' ? 32 : 128
    if (
      Number.isInteger(prefixNumber) &&
      prefixNumber >= 0 &&
      prefixNumber <= maxPrefix
    ) {
      blockList.addSubnet(normalized, prefixNumber, remoteFamily)
    }
  }

  return blockList.check(remoteIp, remoteFamily)
}

function forwardedIp(req: FastifyRequest) {
  const forwarded = firstHeaderValue(req.headers['x-forwarded-for'])
  return normalizeIp(forwarded?.split(',')[0])
}

function extractMeta(req: FastifyRequest) {
  const remoteIp = normalizeIp(req.socket?.remoteAddress)
  const trustedProxies = trustedProxyIps()
  const ipAddress =
    remoteIp && isTrustedProxy(remoteIp, trustedProxies)
      ? (forwardedIp(req) ?? remoteIp)
      : remoteIp

  return {
    ipAddress,
    userAgent: firstHeaderValue(req.headers['user-agent']),
  }
}

export async function getConsentHandler(
  req: FastifyRequest,
  reply: FastifyReply,
) {
  const record = await getConsent(req.user.sub)
  return reply.send(record)
}

export async function createConsentHandler(
  req: FastifyRequest,
  reply: FastifyReply,
) {
  const consent = await createConsent(
    req.user.sub,
    req.body as CreateConsentBody,
    extractMeta(req),
  )
  req.log.info({ userId: req.user.sub }, 'Consent granted')
  return reply.status(201).send(consent)
}

export async function updateConsentHandler(
  req: FastifyRequest,
  reply: FastifyReply,
) {
  const consent = await updateConsent(
    req.user.sub,
    req.body as UpdateConsentBody,
    extractMeta(req),
  )
  req.log.info({ userId: req.user.sub }, 'Consent updated')
  return reply.send(consent)
}

export async function revokeConsentHandler(
  req: FastifyRequest,
  reply: FastifyReply,
) {
  await revokeAllConsents(req.user.sub, extractMeta(req))
  req.log.info({ userId: req.user.sub }, 'All consents revoked')
  return reply.send({
    message: 'Todos os consentimentos opcionais foram revogados.',
  })
}

export async function exportConsentHandler(
  req: FastifyRequest,
  reply: FastifyReply,
) {
  const data = await exportConsentData(req.user.sub, extractMeta(req))
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
