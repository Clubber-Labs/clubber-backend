import { computeEventStatus, resolveEndDate } from './event-lifecycle'

export type RankWeights = {
  /** Pico do sinal temporal quando ONGOING. */
  temporalNow: number
  /** Half-life em horas para decay de eventos futuros. */
  temporalDecayHours: number
  /** Half-life em horas para decay de eventos passados (decai mais rápido). */
  pastDecayHours: number
  /** Multiplicador de log(1+confirmedCount) na soma de engajamento. */
  engagementAttending: number
  engagementComments: number
  engagementReactions: number
  /** Bônus se a categoria do evento bate com o top 1/2/3 do usuário. */
  categoryTop1: number
  categoryTop2: number
  categoryTop3: number
  /** Bônus pela razão social (de FeedReason). */
  reasonSelfCreated: number
  reasonFriendCreated: number
  reasonFriendAttending: number
  reasonFriendReacted: number
  reasonFriendCommented: number
  reasonSelfInteraction: number
  /** Bônus aditivo quando o evento está acontecendo agora — destaque visual. */
  ongoingBoost: number
  /** Bônus menor quando o evento está prestes a acontecer (≤48h). */
  soonBoost: number
}

export const DEFAULT_RANK_WEIGHTS: RankWeights = {
  temporalNow: 100,
  temporalDecayHours: 72,
  pastDecayHours: 24,
  engagementAttending: 30,
  engagementComments: 10,
  engagementReactions: 5,
  categoryTop1: 25,
  categoryTop2: 15,
  categoryTop3: 8,
  reasonSelfCreated: 5,
  reasonFriendCreated: 30,
  reasonFriendAttending: 25,
  reasonFriendReacted: 15,
  reasonFriendCommented: 10,
  reasonSelfInteraction: 20,
  ongoingBoost: 50,
  soonBoost: 10,
}

export type RankReason =
  | { kind: 'self_created' }
  | { kind: 'friend_created' }
  | { kind: 'friend_attending' }
  | { kind: 'friend_reacted' }
  | { kind: 'friend_commented' }
  | { kind: 'self_interaction' }

export type RankContext = {
  /** Top 3 categorias preferidas, em ordem de afinidade. */
  preferredCategories: string[]
  reason: RankReason
  counts: { attendances: number; comments: number; reactions: number }
}

function temporalSignal(
  event: { date: Date; endDate: Date | null; canceledAt: Date | null },
  weights: RankWeights,
  now: Date,
): number {
  if (event.canceledAt) return 0
  const status = computeEventStatus(event, now)
  if (status === 'ONGOING') return weights.temporalNow

  const start = event.date.getTime()
  const end = resolveEndDate(event.date, event.endDate).getTime()
  const t = now.getTime()

  if (t < start) {
    const hoursAhead = (start - t) / (60 * 60 * 1000)
    return weights.temporalNow * 2 ** (-hoursAhead / weights.temporalDecayHours)
  }
  // PAST
  const hoursPast = (t - end) / (60 * 60 * 1000)
  return weights.temporalNow * 2 ** (-hoursPast / weights.pastDecayHours)
}

function engagementSignal(
  counts: RankContext['counts'],
  weights: RankWeights,
): number {
  return (
    Math.log1p(counts.attendances) * weights.engagementAttending +
    Math.log1p(counts.comments) * weights.engagementComments +
    Math.log1p(counts.reactions) * weights.engagementReactions
  )
}

function categorySignal(
  category: string,
  preferred: string[],
  weights: RankWeights,
): number {
  const idx = preferred.indexOf(category)
  if (idx === 0) return weights.categoryTop1
  if (idx === 1) return weights.categoryTop2
  if (idx === 2) return weights.categoryTop3
  return 0
}

function statusBoostSignal(
  event: { date: Date; endDate: Date | null; canceledAt: Date | null },
  weights: RankWeights,
  now: Date,
): number {
  if (event.canceledAt) return 0
  const status = computeEventStatus(event, now)
  if (status === 'ONGOING') return weights.ongoingBoost
  if (status === 'SOON') return weights.soonBoost
  return 0
}

function reasonSignal(reason: RankReason, weights: RankWeights): number {
  switch (reason.kind) {
    case 'self_created':
      return weights.reasonSelfCreated
    case 'friend_created':
      return weights.reasonFriendCreated
    case 'friend_attending':
      return weights.reasonFriendAttending
    case 'friend_reacted':
      return weights.reasonFriendReacted
    case 'friend_commented':
      return weights.reasonFriendCommented
    case 'self_interaction':
      return weights.reasonSelfInteraction
  }
}

export function rankEvent(
  event: {
    date: Date
    endDate: Date | null
    canceledAt: Date | null
    category: string
  },
  context: RankContext,
  weights: RankWeights,
  now: Date,
): number {
  return (
    temporalSignal(event, weights, now) +
    statusBoostSignal(event, weights, now) +
    engagementSignal(context.counts, weights) +
    categorySignal(event.category, context.preferredCategories, weights) +
    reasonSignal(context.reason, weights)
  )
}
