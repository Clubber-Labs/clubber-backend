import { cache } from '../../lib/cache'
import { env } from '../../lib/env'
import { type EventCategory, listCategories } from '../../lib/event-categories'
import {
  adultVenueFilteredTotal,
  socialFilterEmptyTotal,
} from '../../lib/metrics'
import { getPlacesClient, type PlaceCandidate } from '../../lib/places'
import { isAdultVenue } from '../../lib/places/adult-venue'
import { isSocialVenue } from '../../lib/places/social-venue'
import { interestLabels } from '../../lib/subcategories'
import {
  type EnhancedCandidate,
  getProfileQueryComposer,
  getSuggestionEnhancer,
  MAX_PROFILE_QUERIES,
} from '../../lib/suggestion-ai'
import { getUserPremiumStatus } from '../billing/billing.service'
import { isBlockedEitherWay } from '../blocks/blocks.repository'
import {
  findActiveParticipant,
  reactivateParticipant,
} from '../chat/chat.repository'
import { areMutualFollowers } from '../follows/follows.repository'
import {
  enqueueSpotJoined,
  enqueueSpotPublished,
} from '../notifications/notification-queue'
import {
  findSpotRadius,
  findUserPreferredCategories,
  findUserPreferredSubcategories,
  updateSpotRadius,
} from '../users/users.repository'
import {
  cancelSpotById,
  consumeGenerationQuota,
  countActiveMembersByConversation,
  createSpotWithConversation,
  findOwnActiveSpots,
  findSpotDetail,
  findSpotForMutation,
  findSpotForRenew,
  findSpotIdsInBbox,
  findSpotsByIds,
  findTodayGenerationCount,
  renewSpotById,
  type SpotDetail,
  updateSpotById,
} from './spots.repository'
import type {
  CreateSpotBody,
  ListSpotsQuery,
  SuggestionsBody,
  UpdateSpotBody,
} from './spots.schema'

const FREE_DAILY_QUOTA = 5
const PREMIUM_DAILY_QUOTA = 25
const SUGGESTIONS_TTL_SECONDS = 15 * 60

const KM_PER_DEGREE = 111

/**
 * Snap da coordenada à célula de cache derivada do raio. Quanto maior o raio,
 * mais grossa a célula: numa busca regional, usuários a poucos km veem resultados
 * quase idênticos — engrossar eleva o cache hit e corta custo. Célula ~ raio/4
 * (mínimo ~1km), em graus.
 */
function gridCell(value: number, radiusKm: number): string {
  const cellKm = Math.max(1, radiusKm / 4)
  const sizeDeg = cellKm / KM_PER_DEGREE
  return (Math.round(value / sizeDeg) * sizeDeg).toFixed(4)
}

const MAX_ACTIVE_SPOTS = 5
const SPOT_WINDOW_MS = 24 * 60 * 60 * 1000 // 24h por janela (criação e renovação)

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
  const now = Date.now()
  if (body.endsAt <= new Date(now)) {
    throw { statusCode: 400, message: 'endsAt deve estar no futuro' }
  }
  // Teto de 24h por janela: além disso, renova (POST /spots/:id/renew).
  if (body.endsAt.getTime() > now + SPOT_WINDOW_MS) {
    throw {
      statusCode: 400,
      message: 'O rolê pode durar no máximo 24h por vez (renove depois)',
    }
  }
  // Teto verificado dentro da transação (advisory lock) — à prova de corrida.
  const spot = await createSpotWithConversation(
    creatorId,
    body,
    MAX_ACTIVE_SPOTS,
  )
  // Fan-out de proximidade (SPOT_NEARBY), best-effort — não bloqueia a resposta.
  await enqueueSpotPublished(spot.id)
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
 * Lista os spots ativos do próprio usuário (tela "Meus spots"). Diferente do
 * mapa (bbox), aqui o recorte é por dono — para editar/cancelar/renovar os
 * próprios rolês sem depender de onde a câmera do mapa está. Ordenados pelo
 * vencimento mais próximo (limitado pelo teto de spots ativos).
 */
export async function listOwnSpots(creatorId: string) {
  const spots = await findOwnActiveSpots(creatorId, new Date())
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
  // Notifica criador + membros (SPOT_JOIN), best-effort.
  await enqueueSpotJoined(id, userId)
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
 * Renova o spot por mais 24h. Só o criador, só se ainda ativo. Consome 1 da
 * MESMA quota diária de geração (free 5 / premium 25). O endsAt += 24h e o
 * lembrete re-arma (renewalNotifiedAt zerado no repository).
 */
export async function renewSpot(id: string, requesterId: string) {
  const spot = await findSpotForRenew(id)
  if (!spot) throw { statusCode: 404, message: 'Spot não encontrado' }
  if (spot.creatorId !== requesterId) {
    throw { statusCode: 403, message: 'Você não tem permissão para renovar' }
  }
  if (spot.canceledAt || spot.endsAt <= new Date()) {
    throw { statusCode: 409, message: 'Este rolê não está mais ativo' }
  }

  const isPremium = await getUserPremiumStatus(requesterId)
  const limit = isPremium ? PREMIUM_DAILY_QUOTA : FREE_DAILY_QUOTA
  const quota = await consumeGenerationQuota(requesterId, limit)
  if (!quota.allowed) {
    throw {
      statusCode: 429,
      message: `Limite diário de ${limit} usos atingido`,
    }
  }

  const updated = await renewSpotById(id)
  if (!updated) throw { statusCode: 404, message: 'Spot não encontrado' }
  const counts = await countActiveMembersByConversation([
    updated.conversationId,
  ])
  return shapeSpot(updated, counts.get(updated.conversationId) ?? 0)
}

// Raio default quando o usuário não tem valor salvo (linha ausente). Espelha o
// default do notifyRadiusKm — a coluna já nasce 10, então é só um piso defensivo.
const DEFAULT_SPOT_RADIUS_KM = 10

// Puxa um pool largo de candidatos: a IA filtra/ranqueia, então mais matéria-prima
// = recomendação mais robusta. 20 é o teto do Places (New).
const SEARCH_LIMIT = 20

// Teto de sanidade: a Text Search usa viés (não trava), podendo trazer algo
// absurdamente longe. Descarta candidatos além de N× o raio do alcance.
const DISTANCE_CAP_MULTIPLIER = 2

// Quantas sugestões devolver ao cliente, no máximo (UX enxuta; já ranqueadas).
const MAX_SUGGESTIONS = 8

/**
 * Gera sugestões de spot (botão "gerar"): candidatos efêmeros do Places (sempre
 * Text Search) em torno do ponto, no raio escolhido. Dois modos que convergem num
 * CRITÉRIO único de busca/ranqueamento:
 * - Texto livre (`query`): o próprio texto é a busca e o critério (ignora perfil).
 * - Perfil (sem `query`): a IA compõe 1-2 frases de busca a partir do perfil
 *   (categorias + interesses); as MESMAS frases viram o critério de ranqueamento.
 * Os candidatos passam por um filtro estrutural de venue social (pelos `types` do
 * Places) antes da IA ranquear e escrever a copy. Consome 1 da quota diária (5
 * free / 25 premium) — conta mesmo em cache hit. O resultado ENRIQUECIDO é
 * cacheado junto (Places + IA rodam só no cache miss).
 */
export async function generateSuggestions(
  userId: string,
  body: SuggestionsBody,
) {
  const intent = body.query

  // Raio: override do request (validado contra o teto, como no setNotifyRadius)
  // ou o valor salvo do usuário (clampado ao teto, caso o env tenha baixado).
  const maxKm = env.SPOT_MAX_RADIUS_KM
  let radiusKm: number
  if (body.radiusKm !== undefined) {
    if (body.radiusKm > maxKm) {
      throw {
        statusCode: 400,
        message: `Raio máximo permitido: ${maxKm}km`,
        code: 'SPOT_RADIUS_TOO_LARGE',
      }
    }
    radiusKm = body.radiusKm
  } else {
    const saved = (await findSpotRadius(userId)) ?? DEFAULT_SPOT_RADIUS_KM
    radiusKm = Math.min(saved, maxKm)
  }
  const radiusMeters = radiusKm * 1000

  // Sem intenção em texto, a busca depende das preferências de perfil. Com
  // intenção, o texto basta — perfil é ignorado (decisão de produto). Os rótulos
  // (ordem de preferência) alimentam a IA que compõe a query no cache miss; as
  // chaves ordenadas só compõem a chave de cache (estável).
  let profileCategoryLabels: string[] = []
  let profileInterestLabels: string[] = []
  let sortedCats: EventCategory[] = []
  let sortedSubcats: string[] = []
  if (!intent) {
    const categories = await findUserPreferredCategories(userId)
    if (categories.length === 0) {
      throw {
        statusCode: 400,
        message: 'Configure suas preferências de rolê para gerar sugestões',
        code: 'SPOT_NO_PREFERENCES',
      }
    }
    const subcats = await findUserPreferredSubcategories(userId)
    const categoryLabel = new Map(
      listCategories().map((c) => [c.value, c.label]),
    )
    profileCategoryLabels = categories.map((c) => categoryLabel.get(c) ?? c)
    profileInterestLabels = interestLabels(subcats)
    sortedCats = [...categories].sort()
    sortedSubcats = [...subcats].sort()
  }

  const isPremium = await getUserPremiumStatus(userId)
  const limit = isPremium ? PREMIUM_DAILY_QUOTA : FREE_DAILY_QUOTA

  // Rejeita excesso ANTES de chamar o Places (economia de custo). O teto real é
  // garantido pelo consume atômico no fim.
  if ((await findTodayGenerationCount(userId)) >= limit) {
    throw {
      statusCode: 429,
      message: `Limite diário de ${limit} gerações atingido`,
    }
  }

  // Chave de cache: célula geográfica + raio + (intenção OU categorias). A
  // intenção entra normalizada para casar textos equivalentes na mesma região.
  const key = cache.key(
    'spots:suggestions',
    gridCell(body.latitude, radiusKm),
    gridCell(body.longitude, radiusKm),
    `r:${radiusKm}`,
    intent
      ? `q:${intent.toLowerCase()}`
      : `${sortedCats.join(',')}|s:${sortedSubcats.join(',')}`,
  )
  // Busca ANTES de consumir: se o Places/IA falhar, a quota não é gasta. Cache
  // hit também passa por aqui e consome — decisão de produto. Places E IA rodam
  // só no cache miss.
  let suggestions = await cache.get<EnhancedCandidate[]>(key)
  if (!suggestions) {
    // Critério único: o texto livre OU as frases que a IA compõe do perfil. As
    // frases servem a dois propósitos — são as buscas do Places E o critério de
    // ranqueamento (sem recomputar). Composer resiliente: se a IA não devolve
    // nada, cai nos rótulos de categoria (perfil não-vazio garante ≥1 frase).
    let searchQueries: string[]
    if (intent) {
      searchQueries = [intent]
    } else {
      const composed = await getProfileQueryComposer().composeProfileQueries({
        categories: profileCategoryLabels,
        interests: profileInterestLabels,
      })
      searchQueries =
        composed.length > 0
          ? composed
          : profileCategoryLabels.slice(0, MAX_PROFILE_QUERIES)
    }
    const criterion = searchQueries.join('; ')

    // Uma Text Search por frase, em paralelo, mescladas e deduplicadas por placeId
    // (o mesmo lugar pode casar mais de uma frase). Vale para os dois modos —
    // texto livre é só uma frase.
    const perQuery = await Promise.all(
      searchQueries.map((textQuery) =>
        getPlacesClient().searchText({
          textQuery,
          latitude: body.latitude,
          longitude: body.longitude,
          radiusMeters,
          limit: SEARCH_LIMIT,
        }),
      ),
    )
    const byId = new Map<string, PlaceCandidate>()
    for (const c of perQuery.flat()) {
      if (!byId.has(c.placeId)) byId.set(c.placeId, c)
    }
    // Teto de distância: corta o que ficou absurdamente longe do alcance pedido.
    const within = [...byId.values()].filter(
      (c) => c.distanceMeters <= radiusMeters * DISTANCE_CAP_MULTIPLIER,
    )
    // Content-safety: descarta venues adultos (swing/liberal/strip/termas...) pelo
    // NOME — o Places os tipa como night_club/bar, então o filtro estrutural não
    // os pega. Filtro HARD: NUNCA bypassado (melhor 0 sugestões que conteúdo
    // adulto num app de público jovem). Aplicado antes do social/piso.
    const safe = within.filter((c) => !isAdultVenue(c.name))
    adultVenueFilteredTotal.inc(within.length - safe.length)
    // Filtro estrutural de venue social (pelos types do Places) ANTES da IA. Piso:
    // se zerar uma lista não-vazia (só vieram não-sociais), bypassa para não
    // devolver 0 sugestões após gastar quota — e alarma a métrica.
    const social = safe.filter((c) => isSocialVenue(c.types))
    if (safe.length > 0 && social.length === 0) socialFilterEmptyTotal.inc()
    const forAI = social.length > 0 ? social : safe

    const enhanced = await getSuggestionEnhancer().enhance(forAI, { criterion })
    // Cap de itens: devolve só as melhores (já ranqueadas pela IA).
    suggestions = enhanced.slice(0, MAX_SUGGESTIONS)
    await cache.set(key, suggestions, SUGGESTIONS_TTL_SECONDS)
  }

  // Consume atômico — teto à prova de corrida. O pre-flight acima (custo) não
  // garante a vaga: sob concorrência extrema duas reqs passam o pre-flight e a
  // segunda perde a corrida aqui (allowed=false → 429). Caso feliz é dominante.
  const quota = await consumeGenerationQuota(userId, limit)
  if (!quota.allowed) {
    throw {
      statusCode: 429,
      message: `Limite diário de ${limit} gerações atingido`,
    }
  }

  return { suggestions, remaining: Math.max(0, limit - quota.used) }
}

/**
 * Configura o raio salvo (km) da recomendação de spots. Espelha o setNotifyRadius:
 * enforça o teto SPOT_MAX_RADIUS_KM aqui (se o env baixar, raios acima param de
 * ser aceitos — sem degradação silenciosa).
 */
export async function setSpotRadius(userId: string, radiusKm: number) {
  if (radiusKm > env.SPOT_MAX_RADIUS_KM) {
    throw {
      statusCode: 400,
      message: `Raio máximo permitido: ${env.SPOT_MAX_RADIUS_KM}km`,
      code: 'SPOT_RADIUS_TOO_LARGE',
    }
  }
  return updateSpotRadius(userId, radiusKm)
}
