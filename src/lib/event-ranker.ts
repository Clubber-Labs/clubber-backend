import { computeEventStatus, resolveEndDate } from './event-lifecycle'

export type RankWeights = {
  /** Pico do sinal temporal quando ONGOING. */
  temporalNow: number
  /** Half-life em horas para decay de eventos futuros. */
  temporalDecayHours: number
  /** Half-life em horas para decay de eventos passados (decai mais rápido). */
  pastDecayHours: number
  /** Multiplicador de log(1+confirmedCount) na soma de engajamento (popularidade geral). */
  engagementAttending: number
  engagementComments: number
  engagementReactions: number
  /** Multiplicador de log(1+amigosDistintos) — impulso por interação de amigos. */
  friendEngagement: number
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
  /** Razão de descoberta (evento sem laço social) — sem bônus: amigos desempatam na frente. */
  reasonDiscovery: number
  /** Bônus aditivo quando o evento está acontecendo agora — destaque visual. */
  ongoingBoost: number
  /** Bônus menor quando o evento está prestes a acontecer (≤48h). */
  soonBoost: number
  /** Pico do sinal de proximidade quando a distância é ~0. */
  proximityNear: number
  /** Half-life em km do decaimento do sinal de proximidade. */
  proximityHalfLifeKm: number
}

export const DEFAULT_RANK_WEIGHTS: RankWeights = {
  // Tempo é o 2º critério — reduzido pra não rivalizar com popularidade.
  temporalNow: 80,
  temporalDecayHours: 72,
  pastDecayHours: 24,
  // Popularidade lidera — engajamento geral pondera mais que qualquer outro sinal.
  engagementAttending: 40,
  engagementComments: 12,
  engagementReactions: 6,
  // Impulso leve: interação de amigo vale ~1,3x a de estranho.
  friendEngagement: 12,
  categoryTop1: 25,
  categoryTop2: 15,
  categoryTop3: 8,
  reasonSelfCreated: 5,
  reasonFriendCreated: 30,
  reasonFriendAttending: 25,
  reasonFriendReacted: 15,
  reasonFriendCommented: 10,
  reasonSelfInteraction: 20,
  reasonDiscovery: 0,
  ongoingBoost: 30,
  soonBoost: 10,
  proximityNear: 40,
  proximityHalfLifeKm: 10,
}

export type RankReason =
  | { kind: 'self_created' }
  | { kind: 'friend_created' }
  | { kind: 'friend_attending' }
  | { kind: 'friend_reacted' }
  | { kind: 'friend_commented' }
  | { kind: 'self_interaction' }
  | { kind: 'discovery' }

export type RankContext = {
  /** Top 3 categorias preferidas, em ordem de afinidade. */
  preferredCategories: string[]
  reason: RankReason
  counts: { attendances: number; comments: number; reactions: number }
  /** Distância do usuário ao evento em metros, ou null se não há localização. */
  distanceMeters: number | null
  /** Nº de amigos distintos que interagiram com o evento. */
  friendInteractionCount: number
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

/**
 * Impulso por interação de amigos — monotônico crescente no nº de amigos
 * distintos: cada amigo que confirma/reage/comenta sobe o evento. Como esses
 * amigos também entram no engajamento geral, a interação de amigo acaba valendo
 * um pouco mais que a de estranho ("leve impulso").
 */
function friendEngagementSignal(
  friendInteractionCount: number,
  weights: RankWeights,
): number {
  return Math.log1p(friendInteractionCount) * weights.friendEngagement
}

/**
 * Sinal de proximidade — decaimento exponencial por km. Neutro (0) quando não
 * há localização do usuário (distanceMeters null).
 */
function proximitySignal(
  distanceMeters: number | null,
  weights: RankWeights,
): number {
  if (distanceMeters === null) return 0
  const km = distanceMeters / 1000
  return weights.proximityNear * 2 ** (-km / weights.proximityHalfLifeKm)
}

function categorySignal(
  categories: string[],
  preferred: string[],
  weights: RankWeights,
): number {
  // Evento tem N categorias: pontua pelo MELHOR casamento (menor índice entre
  // as preferidas). -1 (não preferida) é ignorado.
  let best = Number.POSITIVE_INFINITY
  for (const c of categories) {
    const idx = preferred.indexOf(c)
    if (idx !== -1 && idx < best) best = idx
  }
  if (best === 0) return weights.categoryTop1
  if (best === 1) return weights.categoryTop2
  if (best === 2) return weights.categoryTop3
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
    case 'discovery':
      return weights.reasonDiscovery
  }
}

export function rankEvent(
  event: {
    date: Date
    endDate: Date | null
    canceledAt: Date | null
    categories: string[]
  },
  context: RankContext,
  weights: RankWeights,
  now: Date,
): number {
  return (
    temporalSignal(event, weights, now) +
    statusBoostSignal(event, weights, now) +
    engagementSignal(context.counts, weights) +
    friendEngagementSignal(context.friendInteractionCount, weights) +
    proximitySignal(context.distanceMeters, weights) +
    categorySignal(event.categories, context.preferredCategories, weights) +
    reasonSignal(context.reason, weights)
  )
}
