import { cache } from '../../lib/cache'
import { getPlacesClient, type PlaceCandidate } from '../../lib/places'
import { isBlockedEitherWay } from '../blocks/blocks.repository'
import {
  findActiveParticipant,
  reactivateParticipant,
} from '../chat/chat.repository'
import { findUserPreferredCategories } from '../feed/feed.repository'
import { areMutualFollowers } from '../follows/follows.repository'
import {
  cancelSpotById,
  consumeGenerationQuota,
  countActiveMembersByConversation,
  createSpotWithConversation,
  findSpotDetail,
  findSpotForMutation,
  findSpotIdsInBbox,
  findSpotsByIds,
  findUserIsPremium,
  type SpotDetail,
  updateSpotById,
} from './spots.repository'
import type {
  CreateSpotBody,
  ListSpotsQuery,
  SuggestionsQuery,
  UpdateSpotBody,
} from './spots.schema'

const FREE_DAILY_QUOTA = 5
const PREMIUM_DAILY_QUOTA = 25
const SUGGESTIONS_TTL_SECONDS = 15 * 60

/** Célula de ~1km (2 casas decimais) para a chave de cache por região. */
function gridCell(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2)
}

const MAX_ACTIVE_SPOTS = 5

function shapeSpot(spot: SpotDetail, memberCount: number) {
  const { creatorId: _creatorId, ...rest } = spot
  return { ...rest, memberCount }
}

/** Viewer pode ver o spot? público, ou criador, ou amigo mútuo (FRIENDS). */
async function canView(
  spot: Pick<SpotDetail, 'visibility' | 'creatorId'>,
  viewerId: string | null,
): Promise<boolean> {
  if (spot.visibility === 'PUBLIC') return true
  if (!viewerId) return false
  if (spot.creatorId === viewerId) return true
  return areMutualFollowers(viewerId, spot.creatorId)
}

export async function createSpot(creatorId: string, body: CreateSpotBody) {
  // endsAt > startsAt já é garantido no schema; aqui barramos o spot "nascido
  // morto" (janela inteira no passado) — `now` é estado externo, fora do Zod.
  if (body.endsAt <= new Date()) {
    throw { statusCode: 400, message: 'endsAt deve estar no futuro' }
  }
  // Teto verificado dentro da transação (advisory lock) — à prova de corrida.
  const spot = await createSpotWithConversation(
    creatorId,
    body,
    MAX_ACTIVE_SPOTS,
  )
  // Recém-criado: só o criador no grupo.
  return shapeSpot(spot, 1)
}

export async function getSpot(viewerId: string | null, id: string) {
  const spot = await findSpotDetail(id)
  if (!spot) throw { statusCode: 404, message: 'Spot não encontrado' }

  // Bloqueio e privacidade ficam atrás de 404 (não vaza existência).
  if (viewerId && (await isBlockedEitherWay(viewerId, spot.creatorId))) {
    throw { statusCode: 404, message: 'Spot não encontrado' }
  }
  if (!(await canView(spot, viewerId))) {
    throw { statusCode: 404, message: 'Spot não encontrado' }
  }

  const counts = await countActiveMembersByConversation([spot.conversationId])
  return shapeSpot(spot, counts.get(spot.conversationId) ?? 0)
}

export async function listSpotsOnMap(
  viewerId: string | null,
  query: ListSpotsQuery,
) {
  if (query.friendsOnly && !viewerId) {
    throw { statusCode: 400, message: 'friendsOnly exige autenticação' }
  }
  const ids = await findSpotIdsInBbox(
    viewerId,
    {
      bboxNorth: query.bboxNorth,
      bboxSouth: query.bboxSouth,
      bboxEast: query.bboxEast,
      bboxWest: query.bboxWest,
      category: query.category,
      friendsOnly: query.friendsOnly,
      limit: query.limit,
    },
    new Date(),
  )
  const spots = await findSpotsByIds(ids)
  const counts = await countActiveMembersByConversation(
    spots.map((s) => s.conversationId),
  )
  return spots.map((s) => shapeSpot(s, counts.get(s.conversationId) ?? 0))
}

/**
 * Entrar no chat do spot = ser membro. Join aberto (sem convite), respeitando
 * bloqueio e, em spot privado, follow mútuo. Idempotente (upsert do participante).
 */
export async function joinSpot(userId: string, id: string) {
  const spot = await findSpotDetail(id)
  if (!spot) throw { statusCode: 404, message: 'Spot não encontrado' }

  // Bloqueio em qualquer direção: trata como inexistente.
  if (await isBlockedEitherWay(userId, spot.creatorId)) {
    throw { statusCode: 404, message: 'Spot não encontrado' }
  }
  if (spot.canceledAt || spot.endsAt <= new Date()) {
    throw { statusCode: 409, message: 'Este rolê não está mais ativo' }
  }
  if (!(await canView(spot, userId))) {
    throw { statusCode: 403, message: 'Spot restrito a amigos do criador' }
  }

  // Já é membro ativo (inclui o criador, que é ADMIN): idempotente e sem
  // rebaixar o role — reactivateParticipant força MEMBER no upsert.
  const existing = await findActiveParticipant(spot.conversationId, userId)
  if (existing) return { conversationId: spot.conversationId, created: false }

  await reactivateParticipant(spot.conversationId, userId)
  return { conversationId: spot.conversationId, created: true }
}

/** Só o criador edita; só título e descrição. */
export async function editSpot(
  id: string,
  requesterId: string,
  data: UpdateSpotBody,
) {
  const spot = await findSpotForMutation(id)
  if (!spot) throw { statusCode: 404, message: 'Spot não encontrado' }
  if (spot.creatorId !== requesterId) {
    throw { statusCode: 403, message: 'Você não tem permissão para editar' }
  }
  if (spot.canceledAt) {
    throw { statusCode: 409, message: 'Spot cancelado não pode ser editado' }
  }
  const updated = await updateSpotById(id, data)
  const counts = await countActiveMembersByConversation([
    updated.conversationId,
  ])
  return shapeSpot(updated, counts.get(updated.conversationId) ?? 0)
}

/** Só o criador cancela. Idempotente: cancelar de novo é no-op. */
export async function cancelSpot(id: string, requesterId: string) {
  const spot = await findSpotForMutation(id)
  if (!spot) throw { statusCode: 404, message: 'Spot não encontrado' }
  if (spot.creatorId !== requesterId) {
    throw { statusCode: 403, message: 'Você não tem permissão para cancelar' }
  }
  if (!spot.canceledAt) await cancelSpotById(id, new Date())
}

/**
 * Gera sugestões de spot (botão "gerar"): candidatos efêmeros do Places perto
 * do ponto, filtrados pelas preferências do usuário. Consome 1 da quota diária
 * (5 free / 25 premium) ANTES de buscar — conta mesmo em cache hit; sem
 * preferências, nem consome (400). Cache por célula de ~1km + categorias.
 */
export async function generateSuggestions(
  userId: string,
  query: SuggestionsQuery,
) {
  const categories = await findUserPreferredCategories(userId)
  if (categories.length === 0) {
    throw {
      statusCode: 400,
      message: 'Configure suas preferências de rolê para gerar sugestões',
    }
  }

  const isPremium = await findUserIsPremium(userId)
  const limit = isPremium ? PREMIUM_DAILY_QUOTA : FREE_DAILY_QUOTA
  const quota = await consumeGenerationQuota(userId, limit)
  if (!quota.allowed) {
    throw {
      statusCode: 429,
      message: `Limite diário de ${limit} gerações atingido`,
    }
  }

  const sortedCats = [...categories].sort()
  const key = cache.key(
    'spots:suggestions',
    gridCell(query.latitude),
    gridCell(query.longitude),
    sortedCats.join(','),
  )
  let suggestions = await cache.get<PlaceCandidate[]>(key)
  if (!suggestions) {
    suggestions = await getPlacesClient().searchNearby({
      latitude: query.latitude,
      longitude: query.longitude,
      categories: sortedCats,
    })
    await cache.set(key, suggestions, SUGGESTIONS_TTL_SECONDS)
  }

  return { suggestions, remaining: Math.max(0, limit - quota.used) }
}
