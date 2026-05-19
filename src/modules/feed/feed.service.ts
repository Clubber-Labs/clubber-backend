import { cache } from '../../lib/cache'
import {
  DEFAULT_RANK_WEIGHTS,
  type RankReason,
  rankEvent,
} from '../../lib/event-ranker'
import {
  findFeedCandidates,
  findFollowingIds,
  findUserPreferredCategories,
} from './feed.repository'
import type { FeedQuery } from './feed.schema'

/**
 * Feed personalizado. Cache por viewer (a personalização do feed
 * depende de followingIds e preferredCategories — não há cache shared
 * possível). TTL curto pra manter percepção de "novidade", mas suficiente
 * pra absorver scroll-up/refresh do mesmo usuário.
 */
export async function getFeed(userId: string, query: FeedQuery) {
  const cacheKey = cache.key('feed', userId, query.limit, query.cursor ?? '')
  const cached =
    await cache.get<Awaited<ReturnType<typeof buildFeedResult>>>(cacheKey)
  if (cached) return cached

  const result = await buildFeedResult(userId, query)
  await cache.set(cacheKey, result, 60)
  return result
}

async function buildFeedResult(userId: string, query: FeedQuery) {
  const now = new Date()

  const [followingIds, preferredCategories] = await Promise.all([
    findFollowingIds(userId),
    findUserPreferredCategories(userId),
  ])

  const candidates = await findFeedCandidates(
    userId,
    followingIds,
    query,
    query.limit,
    query.cursor,
  )

  if (candidates.length === 0) {
    return { data: [], nextCursor: null }
  }

  const data = candidates
    .map((event) => ({
      event,
      score: rankEvent(
        event,
        {
          preferredCategories,
          reason: { kind: event.reason.kind } as RankReason,
          counts: event._count,
        },
        DEFAULT_RANK_WEIGHTS,
        now,
      ),
    }))
    .sort((a, b) => b.score - a.score)
    .map((s) => s.event)

  const hasMore = candidates.length === query.limit
  const nextCursor = hasMore ? candidates[candidates.length - 1].id : null

  return { data, nextCursor }
}
