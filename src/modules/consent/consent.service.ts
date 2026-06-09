import { logger } from '../../lib/logger'
import { clearUserLocation } from '../users/users.repository'
import {
  createConsentWithAudit,
  createExportAuditLog,
  findAuditLogsByUserId,
  findConsentAndLogs,
  findConsentByUserId,
  revokeConsentWithAudit,
  updateConsentFields,
} from './consent.repository'
import {
  ALL_CONSENT_FIELDS,
  type AuditQuery,
  type ConsentField,
  type CreateConsentBody,
  CURRENT_CONSENT_VERSION,
  type UpdateConsentBody,
} from './consent.schema'

type RequestMeta = { ipAddress?: string | null; userAgent?: string }
type AuditEntry = { field: string; from: boolean | null; to: boolean }

/**
 * #4: Gera audit entries filtrando campos que não mudaram de valor,
 * evitando ruído no histórico com eventos sem efeito real.
 */
function buildAuditEntries(
  prev: Record<string, unknown> | null,
  next: Partial<Record<string, boolean>>,
): AuditEntry[] {
  return Object.entries(next)
    .filter(([field, to]) => {
      const from = prev ? ((prev[field] as boolean) ?? null) : null
      return from !== to // só registra quando o valor de fato mudou
    })
    .map(([field, to]) => ({
      field,
      from: prev ? ((prev[field] as boolean) ?? null) : null,
      to: to as boolean,
    }))
}

/**
 * Revogar locationPrecise cessa o tratamento da localização. A query de
 * proximidade já exclui quem não tem locationPrecise=true; aqui apagamos o dado
 * armazenado (minimização). Best-effort: a falha não derruba o fluxo de consent
 * (o reconciler de TTL é o backstop).
 */
async function clearLocationOnRevoke(userId: string) {
  try {
    await clearUserLocation(userId)
  } catch (err) {
    logger.warn(
      { err, userId },
      'falha ao limpar localização na revogação de consentimento',
    )
  }
}

export async function getConsent(userId: string) {
  const record = await findConsentByUserId(userId)
  // #12: delega 404 para o service via throw — controller não usa reply.status()
  if (!record)
    throw { statusCode: 404, message: 'Consentimento não encontrado.' }
  return record
}

export async function createConsent(
  userId: string,
  body: CreateConsentBody,
  meta: RequestMeta,
) {
  const existing = await findConsentByUserId(userId)
  if (existing) {
    throw {
      statusCode: 409,
      message: 'Consentimento já registrado. Use PATCH para atualizar.',
    }
  }

  return createConsentWithAudit({
    userId,
    fields: body as Record<string, boolean>,
    consentVersion: CURRENT_CONSENT_VERSION,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent,
    // #3: registra todos os campos aceitos no momento da criação
    auditEntries: buildAuditEntries(null, body),
  })
}

export async function updateConsent(
  userId: string,
  body: UpdateConsentBody,
  meta: RequestMeta,
) {
  const existing = await findConsentByUserId(userId)
  if (!existing) {
    throw {
      statusCode: 404,
      message: 'Consentimento não encontrado. Use POST para criar.',
    }
  }

  // Revogou localização precisa → limpa a localização (antes do early-return de
  // "nada mudou", para cobrir estados inconsistentes).
  if (body.locationPrecise === false) {
    await clearLocationOnRevoke(userId)
  }

  // #5: body vazio → busca atual e retorna pelo caminho normal (sem early return com objeto bruto)
  const changed = buildAuditEntries(existing as Record<string, unknown>, body)
  if (Object.keys(body).length === 0 || changed.length === 0) {
    // Nada mudou — retorna o estado atual (objeto Prisma, passará pelo serializer na rota)
    return existing
  }

  return updateConsentFields({
    userId,
    fields: body as Record<string, boolean>,
    auditEntries: changed,
    auditIpAddress: meta.ipAddress ?? null,
    auditUserAgent: meta.userAgent,
    consentVersion: CURRENT_CONSENT_VERSION,
    reactivate: changed.some((entry) => entry.to),
  })
}

export async function revokeAllConsents(userId: string, meta: RequestMeta) {
  const existing = await findConsentByUserId(userId)
  if (!existing) {
    throw { statusCode: 404, message: 'Consentimento não encontrado.' }
  }

  const allFalse = Object.fromEntries(
    ALL_CONSENT_FIELDS.map((f) => [f, false]),
  ) as Record<ConsentField, boolean>
  const auditEntries = buildAuditEntries(
    existing as Record<string, unknown>,
    allFalse,
  )

  if (existing.revokedAt && auditEntries.length === 0) return

  await revokeConsentWithAudit({
    userId,
    allFalse,
    auditEntries,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent,
    consentVersion: existing.consentVersion,
  })
  await clearLocationOnRevoke(userId)
}

export async function exportConsentData(userId: string, meta: RequestMeta) {
  const [consent, logs] = await findConsentAndLogs(userId)

  // #1: retorna 404 se o usuário nunca deu consentimento; não cria log EXPORTED fantasma
  if (!consent) {
    throw {
      statusCode: 404,
      message: 'Nenhum dado de consentimento encontrado para exportação.',
    }
  }

  await createExportAuditLog({
    userId,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent,
    consentVersion: consent.consentVersion,
  })

  return {
    exportedAt: new Date().toISOString(),
    currentConsent: consent,
    history: logs,
  }
}

/** #2: Paginação com limit + cursor, seguindo o padrão de listUsers */
export async function getAuditLog(userId: string, query: AuditQuery) {
  return findAuditLogsByUserId(userId, query.limit, query.cursor)
}

export async function hasConsent(
  userId: string,
  field: ConsentField,
): Promise<boolean> {
  const record = await findConsentByUserId(userId)
  if (!record || record.revokedAt) return false
  return Boolean((record as Record<string, unknown>)[field])
}

/** Resumo incluído no /users/me — sem segunda chamada no app */
export async function getConsentSummary(userId: string) {
  const record = await findConsentByUserId(userId)
  if (!record) return { given: false, version: null, revokedAt: null }
  return {
    given: !record.revokedAt,
    version: record.consentVersion,
    revokedAt: record.revokedAt ?? null,
  }
}
