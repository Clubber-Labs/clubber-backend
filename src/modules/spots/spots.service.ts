import { cache } from '../../lib/cache'
import { env } from '../../lib/env'
import { AppError } from '../../lib/errors/app-error'
import type { EventCategory } from '../../lib/event-categories'
import type { Locale } from '../../lib/i18n/locale'
import { t } from '../../lib/i18n/translate'
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
  findMemberPreviewsByConversation,
  findOwnActiveSpots,
  findSpotDetail,
  findSpotForMutation,
  findSpotForRenew,
  findSpotIdsInBbox,
  findSpotIdsNearPoint,
  findSpotsByIds,
  renewSpotById,
  SPOT_MEMBER_PREVIEW,
  type SpotDetail,
  type SpotMemberPreview,
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

/**
 * Shape público do rolê (tira creatorId) — fonte única, usada aqui e no feed.
 *
 * `members` é a prévia do grupo para o pulso social do card. Quando não é
 * hidratada (respostas de escrita), a chave é OMITIDA em vez de vir []: vazio
 * significa "grupo sem ninguém ativo", que é estado possível e diferente de
 * "não carregado".
 */
export function shapeSpot(
  spot: SpotDetail,
  memberCount: number,
  members?: SpotMemberPreview[],
) {
  const { creatorId: _creatorId, ...rest } = spot
  return { ...rest, memberCount, ...(members && { members }) }
}

/** Contagem + prévia de membros em lote, para uma lista de rolês. */
async function withMemberPreviews(spots: SpotDetail[]) {
  const conversationIds = spots.map((s) => s.conversationId)
  const [counts, previews] = await Promise.all([
    countActiveMembersByConversation(conversationIds),
    findMemberPreviewsByConversation(conversationIds, SPOT_MEMBER_PREVIEW),
  ])
  return spots.map((s) =>
    shapeSpot(
      s,
      counts.get(s.conversationId) ?? 0,
      previews.get(s.conversationId) ?? [],
    ),
  )
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
    throw new AppError(400, 'ENDS_AT_IN_PAST')
  }
  // Teto de 24h por janela: além disso, renova (POST /spots/:id/renew).
  if (body.endsAt.getTime() > now + SPOT_WINDOW_MS) {
    throw new AppError(400, 'SPOT_WINDOW_TOO_LONG', undefined, { maxHours: 24 })
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

/**
 * O rolê que o viewer pode ver, ou 404. Bloqueio e privacidade ficam atrás de
 * 404 (não vaza existência). Exportado para quem precisa do mesmo portão sem o
 * shape do detalhe — a denúncia de rolê entra por aqui.
 */
export async function ensureSpotVisible(id: string, viewerId: string | null) {
  const spot = await findSpotDetail(id)
  if (!spot) throw new AppError(404, 'SPOT_NOT_FOUND')

  if (viewerId && (await isBlockedEitherWay(viewerId, spot.creatorId))) {
    throw new AppError(404, 'SPOT_NOT_FOUND')
  }
  if (!(await canView(spot, viewerId))) {
    throw new AppError(404, 'SPOT_NOT_FOUND')
  }
  return spot
}

export async function getSpot(viewerId: string | null, id: string) {
  const spot = await ensureSpotVisible(id, viewerId)
  const [counts, previews] = await Promise.all([
    countActiveMembersByConversation([spot.conversationId]),
    findMemberPreviewsByConversation(
      [spot.conversationId],
      SPOT_MEMBER_PREVIEW,
    ),
  ])
  return shapeSpot(
    spot,
    counts.get(spot.conversationId) ?? 0,
    previews.get(spot.conversationId) ?? [],
  )
}

/**
 * Raio efetivo (km) de uma operação de spots: o do request (validado contra o
 * teto, como no setSpotRadius) > o salvo do usuário > o padrão — os dois
 * últimos clampados ao teto, caso o env tenha baixado.
 */
export async function resolveSpotRadiusKm(
  userId: string | null,
  requested?: number,
): Promise<number> {
  const maxKm = env.SPOT_MAX_RADIUS_KM
  if (requested !== undefined) {
    if (requested > maxKm) {
      throw new AppError(400, 'SPOT_RADIUS_TOO_LARGE', undefined, { maxKm })
    }
    return requested
  }
  const saved = userId ? await findSpotRadius(userId) : null
  return Math.min(saved ?? DEFAULT_SPOT_RADIUS_KM, maxKm)
}

export async function listSpots(
  viewerId: string | null,
  query: ListSpotsQuery,
) {
  if (query.friendsOnly && !viewerId) {
    throw new AppError(400, 'FRIENDS_FILTER_REQUIRES_AUTH')
  }
  const now = new Date()
  const common = {
    category: query.category,
    status: query.status,
    friendsOnly: query.friendsOnly,
    limit: query.limit,
  }

  let ids: string[]
  if (query.nearLat !== undefined && query.nearLng !== undefined) {
    const radiusKm = await resolveSpotRadiusKm(viewerId, query.radiusKm)
    const [preferredCategories, preferredSubcategories]: [
      EventCategory[],
      string[],
    ] = viewerId
      ? await Promise.all([
          findUserPreferredCategories(viewerId),
          findUserPreferredSubcategories(viewerId),
        ])
      : [[], []]
    ids = await findSpotIdsNearPoint(
      viewerId,
      {
        ...common,
        nearLat: query.nearLat,
        nearLng: query.nearLng,
        radiusKm,
        preferredCategories,
        preferredSubcategories,
      },
      now,
    )
  } else if (
    query.bboxNorth !== undefined &&
    query.bboxSouth !== undefined &&
    query.bboxEast !== undefined &&
    query.bboxWest !== undefined
  ) {
    ids = await findSpotIdsInBbox(
      viewerId,
      {
        ...common,
        bboxNorth: query.bboxNorth,
        bboxSouth: query.bboxSouth,
        bboxEast: query.bboxEast,
        bboxWest: query.bboxWest,
      },
      now,
    )
  } else {
    // Inatingível via HTTP: o listSpotsQuerySchema exige bbox completa OU ponto.
    ids = []
  }

  return withMemberPreviews(await findSpotsByIds(ids))
}

/**
 * Lista os spots ativos do próprio usuário (tela "Meus spots"). Diferente do
 * mapa (bbox), aqui o recorte é por dono — para editar/cancelar/renovar os
 * próprios rolês sem depender de onde a câmera do mapa está. Ordenados pelo
 * vencimento mais próximo (limitado pelo teto de spots ativos).
 */
export async function listOwnSpots(creatorId: string) {
  return withMemberPreviews(await findOwnActiveSpots(creatorId, new Date()))
}

/**
 * Entrar no chat do spot = ser membro. Join aberto (sem convite), respeitando
 * bloqueio e, em spot privado, follow mútuo. Idempotente (upsert do participante).
 */
export async function joinSpot(userId: string, id: string) {
  const spot = await findSpotDetail(id)
  if (!spot) throw new AppError(404, 'SPOT_NOT_FOUND')

  // Bloqueio em qualquer direção: trata como inexistente.
  if (await isBlockedEitherWay(userId, spot.creatorId)) {
    throw new AppError(404, 'SPOT_NOT_FOUND')
  }
  if (spot.canceledAt || spot.endsAt <= new Date()) {
    throw new AppError(409, 'SPOT_INACTIVE')
  }
  if (!(await canView(spot, userId))) {
    throw new AppError(403, 'SPOT_FRIENDS_ONLY')
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
  if (!spot) throw new AppError(404, 'SPOT_NOT_FOUND')
  if (spot.creatorId !== requesterId) {
    throw new AppError(403, 'NOT_SPOT_CREATOR')
  }
  if (spot.canceledAt) {
    throw new AppError(409, 'SPOT_CANCELED')
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
  if (!spot) throw new AppError(404, 'SPOT_NOT_FOUND')
  if (spot.creatorId !== requesterId) {
    throw new AppError(403, 'NOT_SPOT_CREATOR')
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
  if (!spot) throw new AppError(404, 'SPOT_NOT_FOUND')
  if (spot.creatorId !== requesterId) {
    throw new AppError(403, 'NOT_SPOT_CREATOR')
  }
  if (spot.canceledAt || spot.endsAt <= new Date()) {
    throw new AppError(409, 'SPOT_INACTIVE')
  }

  const isPremium = await getUserPremiumStatus(requesterId)
  const limit = isPremium ? PREMIUM_DAILY_QUOTA : FREE_DAILY_QUOTA
  const quota = await consumeGenerationQuota(requesterId, limit)
  if (!quota.allowed) {
    throw new AppError(429, 'DAILY_LIMIT_REACHED', undefined, { limit })
  }

  const updated = await renewSpotById(id)
  if (!updated) throw new AppError(404, 'SPOT_NOT_FOUND')
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
  locale: Locale,
) {
  const intent = body.query

  const radiusKm = await resolveSpotRadiusKm(userId, body.radiusKm)
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
      throw new AppError(400, 'SPOT_NO_PREFERENCES')
    }
    const subcats = await findUserPreferredSubcategories(userId)
    // t() direto (não listCategories): preferência legada em categoria
    // deprecada continua com rótulo humano no prompt.
    profileCategoryLabels = categories.map((c) => t(`categories.${c}`, locale))
    profileInterestLabels = interestLabels(subcats, locale)
    sortedCats = [...categories].sort()
    sortedSubcats = [...subcats].sort()
  }

  const isPremium = await getUserPremiumStatus(userId)
  const limit = isPremium ? PREMIUM_DAILY_QUOTA : FREE_DAILY_QUOTA

  // Consome ANTES de Places+IA: o teto atômico passa a limitar o custo externo,
  // não só o contador. Sem estorno — uma falha cara também gasta a vaga, senão o
  // retry imediato pagaria Places+IA de novo sem teto.
  const quota = await consumeGenerationQuota(userId, limit)
  if (!quota.allowed) {
    throw new AppError(429, 'DAILY_LIMIT_REACHED', undefined, { limit })
  }

  // Chave de cache: locale + célula geográfica + raio + (intenção OU
  // categorias). A intenção entra normalizada para casar textos equivalentes na
  // mesma região. O locale é dimensão da chave porque o valor cacheado é a copy
  // JÁ escrita: sem ele, dois usuários da mesma célula dividiriam a entrada e
  // quem chegasse depois receberia o texto no idioma de quem gerou.
  const key = cache.key(
    'spots:suggestions',
    locale,
    gridCell(body.latitude, radiusKm),
    gridCell(body.longitude, radiusKm),
    `r:${radiusKm}`,
    intent
      ? `q:${intent.toLowerCase()}`
      : `${sortedCats.join(',')}|s:${sortedSubcats.join(',')}`,
  )
  // Cache hit também consome (decisão de produto); Places E IA só no cache miss.
  let suggestions = await cache.get<EnhancedCandidate[]>(key)
  if (!suggestions) {
    // Queries de busca: a reescrita do texto livre OU as frases que a IA compõe
    // do perfil. Composer resiliente: se a IA não devolve nada, cai nos rótulos
    // de categoria (perfil não-vazio garante ≥1 frase).
    let searchQueries: string[]
    let intentAnchored = false
    if (intent) {
      // A IA ancora venue/cidade citados ("green valley" -> "Green Valley
      // Balneário Camboriú") e generaliza gênero musical em busca de venue
      // ("balada com megafunk" -> "balada de funk"). `anchored` vem explícito
      // da IA: inferir por diferença de string trataria a reescrita de gênero
      // como destino e desligaria o teto de distância indevidamente.
      const composed = await getProfileQueryComposer().composeIntentQuery(
        intent,
        locale,
      )
      intentAnchored = composed.anchored
      searchQueries = [composed.query]
    } else {
      const composed = await getProfileQueryComposer().composeProfileQueries(
        { categories: profileCategoryLabels, interests: profileInterestLabels },
        locale,
      )
      searchQueries =
        composed.length > 0
          ? composed
          : profileCategoryLabels.slice(0, MAX_PROFILE_QUERIES)
    }
    // Critério de ranqueamento: no modo texto é a INTENÇÃO original — a query
    // generalizada só enche o pool ("balada de funk" busca; "balada com
    // megafunk" ranqueia). No modo perfil, as próprias frases compostas.
    const criterion = intent ?? searchQueries.join('; ')

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
          languageCode: locale,
        }),
      ),
    )
    const byId = new Map<string, PlaceCandidate>()
    for (const c of perQuery.flat()) {
      if (!byId.has(c.placeId)) byId.set(c.placeId, c)
    }
    // Teto de distância: corta o que ficou absurdamente longe do alcance pedido.
    // Única exceção: a IA ancorou a intenção num destino citado no texto ("rolê
    // na green valley" → Camboriú) — aí o longe É o pedido. Reescrita de gênero,
    // texto genérico e IA degradada (fallbacks devolvem anchored: false) mantêm
    // o teto: os fallbacks do enhancer preservam a ordem crua do Places.
    const merged = [...byId.values()]
    const within = intentAnchored
      ? merged
      : merged.filter(
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

    const enhanced = await getSuggestionEnhancer().enhance(forAI, {
      criterion,
      locale,
    })
    // Cap de itens: devolve só as melhores (já ranqueadas pela IA).
    suggestions = enhanced.slice(0, MAX_SUGGESTIONS)
    await cache.set(key, suggestions, SUGGESTIONS_TTL_SECONDS)
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
    throw new AppError(400, 'SPOT_RADIUS_TOO_LARGE', undefined, {
      maxKm: env.SPOT_MAX_RADIUS_KM,
    })
  }
  return updateSpotRadius(userId, radiusKm)
}
