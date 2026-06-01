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
  findSocialCandidateIds,
  findUserPreferredCategories,
  hydrateEvents,
} from './feed.repository'
import type { FeedQuery } from './feed.schema'

// Pool de candidatos a ranquear: maior que a página para que o score (não a
// recência) decida quem entra. Limitado para conter memória/latência.
const POOL_MULTIPLIER = 5
const POOL_FLOOR = 100
const POOL_CAP = 300

type FeedCursor = { score: number; id: string }

function encodeCursor(c: FeedCursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url')
}

function decodeCursor(raw: string): FeedCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (typeof parsed?.id === 'string' && typeof parsed?.score === 'number') {
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
  )
  const cached =
    await cache.get<Awaited<ReturnType<typeof buildFeedResult>>>(cacheKey)
  if (cached) return cached

  const result = await buildFeedResult(userId, query)
  await cache.set(cacheKey, result, 60)
  return result
}

async function buildFeedResult(userId: string, query: FeedQuery) {
  const now = new Date()
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

  const [socialIds, discoveryIds] = await Promise.all([
    findSocialCandidateIds(userId, followingIds, query, poolSize, now),
    findDiscoveryCandidateIds(
      userId,
      preferredCategories,
      center,
      query,
      poolSize,
      now,
    ),
  ])

  const allIds = Array.from(new Set([...socialIds, ...discoveryIds]))
  if (allIds.length === 0) return { data: [], nextCursor: null }

  const [events, distances, friendCounts] = await Promise.all([
    hydrateEvents(allIds, userId, followingIds, now),
    center
      ? findDistancesForEvents(center, allIds)
      : Promise.resolve(new Map<string, number>()),
    findFriendInteractionCounts(allIds, followingIds),
  ])

  const ranked = events
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
        now,
      ),
    }))
    .sort((a, b) => b.score - a.score || b.event.id.localeCompare(a.event.id))

  let startIdx = 0
  if (query.cursor) {
    const decoded = decodeCursor(query.cursor)
    if (!decoded) return { data: [], nextCursor: null }
    const idx = ranked.findIndex((r) => r.event.id === decoded.id)
    if (idx === -1) return { data: [], nextCursor: null }
    startIdx = idx + 1
  }

  const page = ranked.slice(startIdx, startIdx + query.limit)
  const hasMore = startIdx + query.limit < ranked.length
  const last = page[page.length - 1]
  const nextCursor =
    hasMore && last
      ? encodeCursor({ score: last.score, id: last.event.id })
      : null

  return { data: page.map((r) => r.event), nextCursor }
}
