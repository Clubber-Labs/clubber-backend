import { BlockList, isIP } from 'node:net'
import type { FastifyRequest } from 'fastify'

/**
 * IP e user-agent para registros de LGPD (consentimento, aceite de documentos).
 * Fonte única: cadastro e PATCH /consent gravam linhas da mesma trilha de
 * auditoria, então precisam derivar o IP pela mesma regra de proxy confiável —
 * duas noções de "IP do usuário" tornariam a trilha incomparável.
 */
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

export function extractRequestMeta(req: FastifyRequest) {
  const remoteIp = normalizeIp(req.socket?.remoteAddress)
  const trustedProxies = trustedProxyIps()
  const ipAddress =
    remoteIp && isTrustedProxy(remoteIp, trustedProxies)
      ? (forwardedIp(req) ?? remoteIp)
      : remoteIp

  return {
    ipAddress,
    userAgent: firstHeaderValue(req.headers['user-agent']) ?? null,
  }
}
