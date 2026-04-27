import { findFeedEvents, findFollowingIds } from './feed.repository'

export async function getFeed(userId: string, limit: number, cursor?: string) {
  const followingIds = await findFollowingIds(userId)

  const events = await findFeedEvents(userId, followingIds, limit, cursor)
  const nextCursor =
    events.length === limit ? events[events.length - 1].id : null

  return { data: events, nextCursor }
}
