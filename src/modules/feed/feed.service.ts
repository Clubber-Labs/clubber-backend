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

export async function getFeed(userId: string, query: FeedQuery) {
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
