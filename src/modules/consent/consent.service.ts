import { AppError } from '../../lib/errors/app-error'
import { logger } from '../../lib/logger'
import { deleteLinkAndSnapshot as deleteSpotifyLinkAndSnapshot } from '../spotify-link/spotify-link.repository'
import { clearUserLocation } from '../users/users.repository'
import {
  createExportAuditLog,
  findAuditLogsByUserId,
  findConsentAndLogs,
  findConsentByUserId,
  findSpotifyExportData,
  findTermsAcceptances,
  findUserPreferences,
  revokeConsentWithAudit,
  updateConsentFields,
} from './consent.repository'
import {
  ALL_CONSENT_FIELDS,
  type AuditQuery,
  type ConsentField,
  CURRENT_CONSENT_VERSION,
  STRICT_CONSENT_FIELDS,
  type UpdateConsentBody,
  USER_PREFERENCE_FIELDS,
  type UserPreferenceField,
} from './consent.schema'

type RequestMeta = { ipAddress?: string | null; userAgent?: string | null }
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

/**
 * Apaga o vínculo do Spotify na revogação do Art. 18. Best-effort pelo mesmo
 * motivo da localização: a revogação do consentimento não pode falhar por causa
 * de um efeito colateral.
 */
async function deleteSpotifyLinkOnRevoke(userId: string) {
  try {
    await deleteSpotifyLinkAndSnapshot(userId)
  } catch (err) {
    logger.warn(
      { err, userId },
      'falha ao apagar vínculo do Spotify na revogação de consentimento',
    )
  }
}

export async function getConsent(userId: string) {
  const record = await findConsentByUserId(userId)
  // #12: delega 404 para o service via throw — controller não usa reply.status()
  if (!record) throw new AppError(404, 'CONSENT_NOT_FOUND')
  return record
}

export async function updateConsent(
  userId: string,
  body: UpdateConsentBody,
  meta: RequestMeta,
) {
  const existing = await findConsentByUserId(userId)
  if (!existing) {
    // Todo usuário nasce com registro no cadastro: chegar aqui é bug, não fluxo.
    throw new AppError(404, 'CONSENT_NOT_FOUND')
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
    // Só consentimento de fato reativa: um PATCH de espelho do SO chega sem
    // ação do usuário e não pode desfazer uma revogação do Art. 18.
    reactivate: changed.some(
      (entry) =>
        entry.to && STRICT_CONSENT_FIELDS.includes(entry.field as ConsentField),
    ),
  })
}

export async function revokeAllConsents(userId: string, meta: RequestMeta) {
  const existing = await findConsentByUserId(userId)
  if (!existing) {
    throw new AppError(404, 'CONSENT_NOT_FOUND')
  }

  // As preferências moram no User, mas a revogação do Art. 18 é uma só: desligar
  // apenas user_consents deixaria feed, visibilidade e analytics ligados.
  const preferences = await findUserPreferences(userId)

  const allFalse = Object.fromEntries(
    ALL_CONSENT_FIELDS.map((f) => [f, false]),
  ) as Record<ConsentField, boolean>
  const preferencesFalse = Object.fromEntries(
    USER_PREFERENCE_FIELDS.map((f) => [f, false]),
  ) as Record<UserPreferenceField, boolean>

  const auditEntries = [
    ...buildAuditEntries(existing as Record<string, unknown>, allFalse),
    ...buildAuditEntries(preferences, preferencesFalse),
  ]

  if (existing.revokedAt && auditEntries.length === 0) return

  await revokeConsentWithAudit({
    userId,
    allFalse,
    preferencesFalse,
    auditEntries,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent,
    consentVersion: existing.consentVersion,
  })
  await clearLocationOnRevoke(userId)
  // O gosto musical é tratado sob consentimento: revogar tem de apagar o
  // vínculo e o snapshot, senão a revogação seria só de fachada.
  await deleteSpotifyLinkOnRevoke(userId)
}

export async function exportConsentData(userId: string, meta: RequestMeta) {
  const [[consent, logs], preferences, acceptances, spotify] =
    await Promise.all([
      findConsentAndLogs(userId),
      findUserPreferences(userId),
      findTermsAcceptances(userId),
      findSpotifyExportData(userId),
    ])

  // #1: retorna 404 se o usuário nunca deu consentimento; não cria log EXPORTED fantasma
  if (!consent) {
    throw new AppError(404, 'CONSENT_EXPORT_EMPTY')
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
    // Preferências e aceites vivem fora de user_consents, mas o titular tem
    // direito ao conjunto — exportar só a tabela devolveria um retrato parcial.
    preferences,
    termsAcceptances: acceptances,
    spotify,
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
