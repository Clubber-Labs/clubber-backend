import { cache } from '../../lib/cache'
import {
  DEFAULT_RANK_WEIGHTS,
  type RankReason,
  rankEvent,
} from '../../lib/event-ranker'
import { findDistancesForEvents, type LatLng } from '../../lib/spatial'
import {
  findDiscoveryCandidateIds,
  findFollowingIds,
  findFriendInteractionCounts,
  findPromotedPinCandidates,
  findSocialCandidateIds,
  findUserPreferredCategories,
  hydrateEvents,
} from './feed.repository'
import type { FeedQuery } from './feed.schema'

// Posição do slot patrocinado na 1ª página (0-based). Índice 1 = logo após o
// primeiro orgânico, padrão "sponsored" sem roubar o topo.
const PROMOTED_PIN_INDEX = 1

function distSq(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const dLat = a.latitude - b.latitude
  const dLng = a.longitude - b.longitude
  return dLat * dLat + dLng * dLng
}

// Pool de candidatos a ranquear: maior que a página para que o score (não a
// recência) decida quem entra. Limitado para conter memória/latência.
const POOL_MULTIPLIER = 5
const POOL_FLOOR = 100
const POOL_CAP = 300

// `t`: epoch (ms) do relógio de ranking, fixado na 1ª página e propagado nas
// seguintes. O score depende de `now` (decay temporal, boost ONGOING/SOON); sem
// congelar esse instante, cada página recalcula o score com um `now` diferente e
// a fronteira do cursor passa a duplicar (ou sumir com) eventos. Opcional só por
// retrocompatibilidade: cursores antigos sem `t` caem no relógio do request.
type FeedCursor = { score: number; id: string; t?: number }

function encodeCursor(c: { score: number; id: string; t: number }): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url')
}

function decodeCursor(raw: string): FeedCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (
      typeof parsed?.id === 'string' &&
      typeof parsed?.score === 'number' &&
      (parsed.t === undefined || typeof parsed.t === 'number')
    ) {
      return parsed as FeedCursor
    }
    return null
  } catch {
    return null
  }
}

/**
 * Feed personalizado. Cache por viewer + localização (a personalização depende
 * de followingIds, preferredCategories e da posição do dispositivo). TTL curto
 * pra manter percepção de "novidade" e absorver scroll-up/refresh.
 */
export async function getFeed(userId: string, query: FeedQuery) {
  const cacheKey = cache.key(
    'feed',
    userId,
    query.limit,
    query.cursor ?? '',
    query.nearLat ?? '',
    query.nearLng ?? '',
    query.radiusKm ?? '',
    query.category?.join(',') ?? '',
    query.status?.join(',') ?? '',
    String(query.includePast),
    query.dateFrom?.toISOString() ?? '',
    query.dateTo?.toISOString() ?? '',
  )
  const cached =
    await cache.get<Awaited<ReturnType<typeof buildFeedResult>>>(cacheKey)
  if (cached) return cached

  const result = await buildFeedResult(userId, query)
  await cache.set(cacheKey, result, 60)
  return result
}

async function buildFeedResult(userId: string, query: FeedQuery) {
  // Decodifica o cursor ANTES de tudo: ele marca a fronteira (score, id) e
  // carrega o relógio de ranking (t) definido na 1ª página.
  const decoded = query.cursor ? decodeCursor(query.cursor) : null
  if (query.cursor && !decoded) return { data: [], nextCursor: null }

  // `now` real do servidor — usado em ELEGIBILIDADE (lifecycle/WHERE) e no
  // status retornado. NUNCA vem do cursor: o `t` é cliente-controlável; se
  // entrasse no WHERE de lifecycle, um cursor forjado burlaria o filtro `status`
  // (ex.: `t` antigo + status=UPCOMING devolveria eventos hoje PAST).
  const now = new Date()
  // `scoringNow` — relógio de RANKING, congelado na 1ª página e propagado via
  // cursor. O score depende do tempo (decay temporal, boost ONGOING/SOON);
  // congelá-lo mantém a fronteira do keyset estável entre as páginas. Forjar `t`
  // só reordena o feed do próprio requester — não muda quais linhas o banco
  // retorna nem o status exibido.
  const scoringNow = decoded?.t !== undefined ? new Date(decoded.t) : now
  const center: LatLng | null =
    query.nearLat !== undefined && query.nearLng !== undefined
      ? { latitude: query.nearLat, longitude: query.nearLng }
      : null
  const poolSize = Math.min(
    Math.max(query.limit * POOL_MULTIPLIER, POOL_FLOOR),
    POOL_CAP,
  )

  const [followingIds, preferredCategories] = await Promise.all([
    findFollowingIds(userId),
    findUserPreferredCategories(userId),
  ])

  const [socialIds, discoveryIds, pinCandidates] = await Promise.all([
    findSocialCandidateIds(userId, followingIds, query, poolSize, now),
    findDiscoveryCandidateIds(
      preferredCategories,
      center,
      query,
      poolSize,
      now,
    ),
    findPromotedPinCandidates(userId, query, now),
  ])

  // Slot patrocinado: escolhe 1 promovido (mais próximo do viewer; sem
  // localização, o de data mais próxima). Calculado em TODA página para poder
  // EXCLUIR o pinado do fluxo orgânico (a seleção é estável dentro do TTL do
  // cache, então o keyset das páginas seguintes não o reencontra) — mas a
  // INJEÇÃO só acontece na 1ª página (sem cursor).
  const pinId =
    pinCandidates.length === 0
      ? null
      : center
        ? pinCandidates.reduce((best, c) =>
            distSq(c, center) < distSq(best, center) ? c : best,
          ).id
        : pinCandidates[0].id

  // Social primeiro (prioriza a rede do viewer), depois descoberta; capado em
  // POOL_CAP pra hidratação nunca passar do teto mesmo com as duas pools cheias.
  // O pinado sai do fluxo orgânico (vai pelo slot patrocinado, sem duplicar).
  const organicIds = Array.from(new Set([...socialIds, ...discoveryIds]))
    .filter((id) => id !== pinId)
    .slice(0, POOL_CAP)
  const isFirstPage = !decoded
  const pinToInject = isFirstPage ? pinId : null
  const allIds = pinToInject ? [...organicIds, pinToInject] : organicIds
  if (allIds.length === 0) return { data: [], nextCursor: null }

  const [events, distances, friendCounts] = await Promise.all([
    hydrateEvents(allIds, userId, followingIds, now),
    center
      ? findDistancesForEvents(center, allIds)
      : Promise.resolve(new Map<string, number>()),
    findFriendInteractionCounts(allIds, followingIds),
  ])

  const pinnedEvent = pinToInject
    ? events.find((e) => e.id === pinToInject)
    : undefined

  const ranked = events
    .filter((event) => event.id !== pinToInject)
    .map((event) => ({
      event,
      score: rankEvent(
        event,
        {
          preferredCategories,
          reason: { kind: event.reason.kind } as RankReason,
          counts: event._count,
          distanceMeters: distances.get(event.id) ?? null,
          friendInteractionCount: friendCounts.get(event.id) ?? 0,
        },
        DEFAULT_RANK_WEIGHTS,
        scoringNow,
      ),
    }))
    .sort((a, b) => b.score - a.score || b.event.id.localeCompare(a.event.id))

  // Paginação por valor (score, id), não por posição: o corte é feito pelos
  // critérios do cursor, então mudanças no pool entre páginas (TTL expirado,
  // evento removido) não quebram o scroll nem duplicam itens.
  let candidates = ranked
  if (decoded) {
    candidates = ranked.filter(
      (r) =>
        r.score < decoded.score ||
        (r.score === decoded.score && r.event.id.localeCompare(decoded.id) < 0),
    )
  }

  // Com pin, a página orgânica encolhe 1 pra manter o total = limit.
  const organicLimit = pinnedEvent ? Math.max(query.limit - 1, 1) : query.limit
  const page = candidates.slice(0, organicLimit)
  const hasMore = candidates.length > organicLimit
  const last = page[page.length - 1]
  const nextCursor =
    hasMore && last
      ? encodeCursor({
          score: last.score,
          id: last.event.id,
          t: scoringNow.getTime(),
        })
      : null

  const data: (FeedEventWithPin | undefined)[] = page.map((r) => r.event)
  if (pinnedEvent) {
    const at = Math.min(PROMOTED_PIN_INDEX, data.length)
    data.splice(at, 0, { ...pinnedEvent, promoted: true })
  }

  return { data, nextCursor }
}

type FeedEventWithPin = Awaited<ReturnType<typeof hydrateEvents>>[number] & {
  promoted?: boolean
}
