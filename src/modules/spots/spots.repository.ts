import { Prisma } from '@prisma/client'
import { AppError } from '../../lib/errors/app-error'
import type { EventCategory } from '../../lib/event-categories'
import { type EventStatus, SOON_THRESHOLD_MS } from '../../lib/event-lifecycle'
import { prisma } from '../../lib/prisma'
import type { CreateSpotBody } from './spots.schema'

const creatorSelect = {
  id: true,
  name: true,
  lastname: true,
  username: true,
  avatarUrl: true,
} as const

const spotDetailSelect = {
  id: true,
  title: true,
  description: true,
  categories: true,
  subcategories: true,
  visibility: true,
  placeId: true,
  latitude: true,
  longitude: true,
  startsAt: true,
  endsAt: true,
  canceledAt: true,
  createdAt: true,
  conversationId: true,
  creatorId: true,
  creator: { select: creatorSelect },
} as const

export type SpotDetail = Prisma.SpotGetPayload<{
  select: typeof spotDetailSelect
}>

/**
 * Publica o spot: cria a conversa GROUP aberta (criador como ADMIN) e o spot
 * ligado a ela, numa transação — um nasce com o outro ou nenhum.
 *
 * O teto de spots ativos é verificado DENTRO da transação, atrás de um advisory
 * lock por criador. Sob READ COMMITTED um COUNT em transação não basta (dois
 * requests concorrentes leem o mesmo valor antes de qualquer INSERT); o lock
 * serializa as criações do MESMO usuário, então o teto nunca é furado por corrida.
 */
export async function createSpotWithConversation(
  creatorId: string,
  data: CreateSpotBody,
  maxActive: number,
): Promise<SpotDetail> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`spot_cap:${creatorId}`}))`
    const active = await tx.spot.count({
      where: { creatorId, canceledAt: null, endsAt: { gt: new Date() } },
    })
    if (active >= maxActive) {
      throw new AppError(409, 'ACTIVE_SPOT_LIMIT', undefined, {
        max: maxActive,
      })
    }
    const conversation = await tx.conversation.create({
      data: {
        type: 'GROUP',
        title: data.title,
        createdById: creatorId,
        participants: { create: [{ userId: creatorId, role: 'ADMIN' }] },
      },
    })
    return tx.spot.create({
      data: {
        title: data.title,
        description: data.description ?? null,
        categories: data.categories,
        subcategories: data.subcategories ?? [],
        visibility: data.visibility,
        placeId: data.placeId,
        latitude: data.latitude,
        longitude: data.longitude,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        creatorId,
        conversationId: conversation.id,
      },
      select: spotDetailSelect,
    })
  })
}

export async function findSpotDetail(id: string): Promise<SpotDetail | null> {
  return prisma.spot.findUnique({ where: { id }, select: spotDetailSelect })
}

/** Campos para o fan-out de notificação (proximidade na publicação + join). */
export async function findSpotForFanout(id: string) {
  return prisma.spot.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      latitude: true,
      longitude: true,
      categories: true,
      subcategories: true,
      visibility: true,
      creatorId: true,
      conversationId: true,
      canceledAt: true,
      endsAt: true,
      creator: { select: { isPremium: true } },
    },
  })
}

/** Campos mínimos para autorizar mutação (dono) e checar estado. */
export async function findSpotForMutation(id: string) {
  return prisma.spot.findUnique({
    where: { id },
    select: { id: true, creatorId: true, canceledAt: true },
  })
}

/** Como findSpotForMutation, mais endsAt — para o gate de "ativo" do renew. */
export async function findSpotForRenew(id: string) {
  return prisma.spot.findUnique({
    where: { id },
    select: { id: true, creatorId: true, canceledAt: true, endsAt: true },
  })
}

/**
 * Renova: empurra endsAt +24h e ZERA renewalNotifiedAt (re-arma o lembrete para
 * a nova janela). O +24h é a partir do endsAt ATUAL, no SQL (atômico).
 */
export async function renewSpotById(id: string): Promise<SpotDetail | null> {
  // RETURNING detecta atomicamente se o UPDATE pegou alguma linha — se o spot
  // sumiu nesse meio-tempo, rows vazio → null (sem um SELECT extra à toa).
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    UPDATE "spots"
    SET "endsAt" = "endsAt" + interval '24 hours',
        "renewalNotifiedAt" = NULL,
        "updatedAt" = now()
    WHERE id = ${id}
    RETURNING id`)
  if (rows.length === 0) return null
  return findSpotDetail(id)
}

export async function updateSpotById(
  id: string,
  data: { title?: string; description?: string | null },
): Promise<SpotDetail> {
  return prisma.$transaction(async (tx) => {
    const spot = await tx.spot.update({
      where: { id },
      data,
      select: spotDetailSelect,
    })
    // O título do spot e o do grupo nascem iguais (createSpotWithConversation);
    // renomear o spot renomeia o chat junto, senão o cabeçalho fica defasado.
    if (data.title !== undefined) {
      await tx.conversation.update({
        where: { id: spot.conversationId },
        data: { title: data.title },
      })
    }
    return spot
  })
}

export async function cancelSpotById(id: string, now: Date) {
  return prisma.spot.update({
    where: { id },
    data: { canceledAt: now },
    select: { id: true },
  })
}

/** Membros ativos por conversa (batch) — `memberCount` dos balões = participar do chat. */
export async function countActiveMembersByConversation(
  conversationIds: string[],
): Promise<Map<string, number>> {
  if (conversationIds.length === 0) return new Map()
  const rows = await prisma.conversationParticipant.groupBy({
    by: ['conversationId'],
    where: { conversationId: { in: conversationIds }, leftAt: null },
    _count: { _all: true },
  })
  return new Map(rows.map((r) => [r.conversationId, r._count._all]))
}

/**
 * Teto da prévia de membros por rolê. O pulso social do card (SpotPulseRow no
 * mobile) enche a linha com quantos avatares couberem: no aparelho mais largo
 * cabem 15 círculos de 36px com sobreposição de 12 — 14 avatares + o "+N".
 * Acima disso é hidratação que nunca aparece.
 *
 * Mora aqui (e não no feed, que era o único a hidratá-la) porque mapa, detalhe
 * e "meus rolês" leem a mesma prévia — teto por superfície seria "+N" diferente
 * para o mesmo rolê.
 */
export const SPOT_MEMBER_PREVIEW = 14

export type SpotMemberPreview = Prisma.UserGetPayload<{
  select: typeof creatorSelect
}>

/**
 * Prévia do grupo por conversa: os primeiros membros ativos em ordem de
 * entrada (o criador vem primeiro por construção — entrou na criação).
 *
 * LATERAL porque o corte tem que ser POR grupo dentro do SQL: nem `findMany`
 * nem o `take` aninhado do Prisma limitam por conversa (o take corta na engine,
 * depois de trazer TODOS os participantes do lote) — e o feed hidrata até
 * poolSize rolês por request.
 *
 * A ordem é a MESMA da lista de participantes do chat (joinedAt, userId — ver
 * activeParticipantsInclude): quem abre o card e quem abre o grupo tem que ver
 * o mesmo primeiro membro.
 */
export async function findMemberPreviewsByConversation(
  conversationIds: string[],
  limit: number,
): Promise<Map<string, SpotMemberPreview[]>> {
  if (conversationIds.length === 0) return new Map()
  const ids = Prisma.join(conversationIds.map((id) => Prisma.sql`(${id})`))
  const rows = await prisma.$queryRaw<
    (SpotMemberPreview & { conversationId: string })[]
  >(Prisma.sql`
    SELECT c.id AS "conversationId",
           u.id, u.name, u.lastname, u.username, u."avatarUrl"
    FROM (VALUES ${ids}) AS c(id)
    CROSS JOIN LATERAL (
      SELECT cp."userId", cp."joinedAt"
      FROM conversation_participants cp
      WHERE cp."conversationId" = c.id AND cp."leftAt" IS NULL
      ORDER BY cp."joinedAt" ASC, cp."userId" ASC
      LIMIT ${limit}
    ) top
    JOIN users u ON u.id = top."userId"
    ORDER BY top."joinedAt" ASC, top."userId" ASC`)
  const previews = new Map<string, SpotMemberPreview[]>()
  for (const { conversationId, ...member } of rows) {
    const members = previews.get(conversationId) ?? []
    members.push(member)
    previews.set(conversationId, members)
  }
  return previews
}

/** Amigos (ids dados) ativos por conversa — sinal de ranking do feed misto. */
export async function countFriendMembersByConversation(
  conversationIds: string[],
  friendIds: string[],
): Promise<Map<string, number>> {
  if (conversationIds.length === 0 || friendIds.length === 0) return new Map()
  const rows = await prisma.conversationParticipant.groupBy({
    by: ['conversationId'],
    where: {
      conversationId: { in: conversationIds },
      userId: { in: friendIds },
      leftAt: null,
    },
    _count: { _all: true },
  })
  return new Map(rows.map((r) => [r.conversationId, r._count._all]))
}

type SpotListFilters = {
  category?: string[]
  status?: EventStatus[]
  friendsOnly: boolean
  limit: number
}

export type SpotMapFilters = SpotListFilters & {
  bboxNorth: number
  bboxSouth: number
  bboxEast: number
  bboxWest: number
}

export type SpotNearFilters = SpotListFilters & {
  nearLat: number
  nearLng: number
  radiusKm: number
  preferredCategories: EventCategory[]
  preferredSubcategories: string[]
}

/**
 * Predicado de status do rolê, derivado de `startsAt` (o Spot sempre tem `endsAt`,
 * então não há o fallback de duração padrão que o evento precisa). A query base já
 * garante ativo — não cancelado e `endsAt > now` —, logo PAST e CANCELED não
 * existem no conjunto e nunca casam.
 *
 * Filtro só com status inalcançáveis (ex.: `status=PAST`) vira `AND FALSE`:
 * `Prisma.empty` aqui significaria "sem filtro" e devolveria TODOS os rolês.
 */
function statusPredicate(
  status: EventStatus[] | undefined,
  now: Date,
): Prisma.Sql {
  if (!status || status.length === 0) return Prisma.empty

  const soonBoundary = new Date(now.getTime() + SOON_THRESHOLD_MS)
  const conditions = status.flatMap((s) => {
    switch (s) {
      case 'ONGOING':
        return [Prisma.sql`s."startsAt" <= ${now}`]
      case 'SOON':
        return [
          Prisma.sql`(s."startsAt" > ${now} AND s."startsAt" <= ${soonBoundary})`,
        ]
      case 'UPCOMING':
        return [Prisma.sql`s."startsAt" > ${soonBoundary}`]
      default:
        return []
    }
  })
  if (conditions.length === 0) return Prisma.sql`AND FALSE`
  return Prisma.sql`AND (${Prisma.join(conditions, ' OR ')})`
}

/**
 * Core das listagens espaciais. Filtra no SQL (camada certa): janela ativa,
 * predicado espacial do modo (índice GiST sobre location), interseção de
 * categorias, status, bloqueio mútuo e visibilidade (público; ou criador; ou
 * FRIENDS via follow mútuo). Viewer anônimo (null) só enxerga PUBLIC e nunca
 * com friendsOnly.
 *
 * "Ativo" = não cancelado E ainda não encerrado (`endsAt > now`) — inclui os
 * que ainda não começaram (upcoming): o objetivo é entrar no chat e COMBINAR
 * antes do rolê. startsAt é só o horário exibido, não um gate de visibilidade.
 */
async function findVisibleSpotIds(
  viewerId: string | null,
  filters: SpotListFilters,
  now: Date,
  spatial: Prisma.Sql,
  orderBy: Prisma.Sql,
): Promise<string[]> {
  if (filters.friendsOnly && !viewerId) return []

  const categoryFilter =
    filters.category && filters.category.length > 0
      ? Prisma.sql`AND s.categories && ${filters.category}::"EventCategory"[]`
      : Prisma.empty

  const status = statusPredicate(filters.status, now)

  const mutualFollow = (id: string) => Prisma.sql`EXISTS (
    SELECT 1 FROM follows f1
    JOIN follows f2
      ON f2."followerId" = s."creatorId"
     AND f2."followingId" = ${id}
     AND f2.status = 'ACCEPTED'
    WHERE f1."followerId" = ${id}
      AND f1."followingId" = s."creatorId"
      AND f1.status = 'ACCEPTED'
  )`

  let visibility: Prisma.Sql
  if (!viewerId) {
    visibility = Prisma.sql`s.visibility = 'PUBLIC'`
  } else if (filters.friendsOnly) {
    // Só rolês de amigos (mútuos) ou os próprios, ignorando os públicos de estranhos.
    visibility = Prisma.sql`(s."creatorId" = ${viewerId} OR ${mutualFollow(viewerId)})`
  } else {
    visibility = Prisma.sql`(
      s.visibility = 'PUBLIC'
      OR s."creatorId" = ${viewerId}
      OR ${mutualFollow(viewerId)}
    )`
  }

  const blockExclusion = viewerId
    ? Prisma.sql`AND NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b."blockerId" = ${viewerId} AND b."blockedId" = s."creatorId")
           OR (b."blockerId" = s."creatorId" AND b."blockedId" = ${viewerId})
      )`
    : Prisma.empty

  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT s.id
    FROM spots s
    WHERE s."canceledAt" IS NULL
      AND s."endsAt" > ${now}
      AND ${spatial}
      ${categoryFilter}
      ${status}
      AND ${visibility}
      ${blockExclusion}
    ORDER BY ${orderBy}
    LIMIT ${filters.limit}
  `)
  return rows.map((r) => r.id)
}

/** IDs dos spots visíveis dentro da bbox (viewport do mapa). */
export async function findSpotIdsInBbox(
  viewerId: string | null,
  filters: SpotMapFilters,
  now: Date,
): Promise<string[]> {
  const envelope = Prisma.sql`ST_MakeEnvelope(${filters.bboxWest}, ${filters.bboxSouth}, ${filters.bboxEast}, ${filters.bboxNorth}, 4326)::geography`
  return findVisibleSpotIds(
    viewerId,
    filters,
    now,
    Prisma.sql`s.location && ${envelope}`,
    Prisma.sql`s."createdAt" DESC`,
  )
}

/**
 * Modo ponto+raio (seção "rolês perto de você" do feed): mesmos predicados do
 * mapa, cortado por ST_DWithin e ordenado com os rolês que casam com as
 * preferências do perfil primeiro, depois do mais perto pro mais longe.
 */
export async function findSpotIdsNearPoint(
  viewerId: string | null,
  filters: SpotNearFilters,
  now: Date,
): Promise<string[]> {
  const point = Prisma.sql`ST_SetSRID(ST_MakePoint(${filters.nearLng}, ${filters.nearLat}), 4326)::geography`
  const hasPrefs =
    filters.preferredCategories.length > 0 ||
    filters.preferredSubcategories.length > 0
  const prefBoost = hasPrefs
    ? Prisma.sql`(s.categories && ${filters.preferredCategories}::"EventCategory"[] OR s.subcategories && ${filters.preferredSubcategories}::text[]) DESC,`
    : Prisma.empty
  return findVisibleSpotIds(
    viewerId,
    filters,
    now,
    Prisma.sql`ST_DWithin(s.location, ${point}, ${filters.radiusKm * 1000})`,
    Prisma.sql`${prefBoost} s.location <-> ${point}`,
  )
}

export async function findSpotsByIds(ids: string[]): Promise<SpotDetail[]> {
  if (ids.length === 0) return []
  const spots = await prisma.spot.findMany({
    where: { id: { in: ids } },
    select: spotDetailSelect,
  })
  // Preserva a ordem do ranking espacial (createdAt DESC do SQL).
  const byId = new Map(spots.map((s) => [s.id, s]))
  return ids.map((id) => byId.get(id)).filter((s): s is SpotDetail => !!s)
}

/**
 * Spots ativos do criador (tela "Meus spots"): não cancelados e ainda na janela
 * (endsAt > now). Ordenados pelo vencimento mais próximo — quem está prestes a
 * expirar aparece primeiro (contexto pra renovar). Limitado naturalmente pelo
 * teto de spots ativos por usuário.
 */
export async function findOwnActiveSpots(
  creatorId: string,
  now: Date,
): Promise<SpotDetail[]> {
  return prisma.spot.findMany({
    where: { creatorId, canceledAt: null, endsAt: { gt: now } },
    orderBy: { endsAt: 'asc' },
    select: spotDetailSelect,
  })
}

/** Spots ativos vencendo dentro de `leadMs` e ainda não lembrados. */
export async function findSpotsNeedingRenewalReminder(
  now: Date,
  leadMs: number,
  limit: number,
) {
  return prisma.spot.findMany({
    where: {
      canceledAt: null,
      renewalNotifiedAt: null,
      endsAt: { gt: now, lte: new Date(now.getTime() + leadMs) },
    },
    select: { id: true, title: true, creatorId: true, endsAt: true },
    take: limit,
  })
}

/** CAS: marca o lembrete como enviado só se ainda NULL. count 0 = outro tick venceu. */
export async function markSpotRenewalNotified(
  spotId: string,
  now: Date,
): Promise<number> {
  const res = await prisma.spot.updateMany({
    where: { id: spotId, renewalNotifiedAt: null },
    data: { renewalNotifiedAt: now },
  })
  return res.count
}

/** Spots "concluídos" elegíveis para limpeza: cancelados OU já encerrados. */
export async function findCleanableSpots(now: Date, limit: number) {
  return prisma.spot.findMany({
    where: { OR: [{ canceledAt: { not: null } }, { endsAt: { lte: now } }] },
    select: { id: true, conversationId: true },
    take: limit,
  })
}

/**
 * Limpeza atômica de um spot concluído. Numa única transação:
 *  1. apaga o spot SE ainda elegível (cancelado ou encerrado) — guard anti-corrida
 *     com renew; se renovou entre a seleção e aqui, count 0 → 'skipped';
 *  2. com o spot já fora, decide o destino da conversa: se só resta o criador
 *     (≤1 membro ativo) apaga a conversa junto ('deleted'); senão o grupo
 *     "gradua" e sobrevive como conversa normal ('graduated').
 *
 * A atomicidade é o ponto: spot e conversa caem juntos ou nenhum cai — sem ela,
 * um crash entre os dois passos deixaria a conversa órfã para sempre (o spot já
 * não existe, então nenhum tick futuro a recolhe). A ordem respeita a FK
 * spot→conversation RESTRICT (spot primeiro).
 */
export async function deleteCleanableSpot(
  spotId: string,
  conversationId: string,
  now: Date,
): Promise<'deleted' | 'graduated' | 'skipped'> {
  return prisma.$transaction(async (tx) => {
    const res = await tx.spot.deleteMany({
      where: {
        id: spotId,
        OR: [{ canceledAt: { not: null } }, { endsAt: { lte: now } }],
      },
    })
    if (res.count === 0) return 'skipped'

    const members = await tx.conversationParticipant.count({
      where: { conversationId, leftAt: null },
    })
    if (members <= 1) {
      await tx.conversation.deleteMany({ where: { id: conversationId } })
      return 'deleted'
    }
    return 'graduated'
  })
}

/**
 * Consome 1 da quota diária de geração, de forma ATÔMICA e à prova de corrida:
 * o upsert só incrementa enquanto `count < limit` (cláusula WHERE no ON CONFLICT).
 * Se já está no limite, o UPDATE não acontece e o RETURNING vem vazio → negado.
 * `CURRENT_DATE` (data do servidor) define o dia, evitando descompasso de fuso
 * entre app e banco.
 */
export async function consumeGenerationQuota(
  userId: string,
  limit: number,
): Promise<{ allowed: boolean; used: number }> {
  const rows = await prisma.$queryRaw<{ count: number }[]>(Prisma.sql`
    INSERT INTO "spot_generation_usage" ("userId", "day", "count", "updatedAt")
    VALUES (${userId}, CURRENT_DATE, 1, now())
    ON CONFLICT ("userId", "day")
    DO UPDATE SET "count" = "spot_generation_usage"."count" + 1, "updatedAt" = now()
    WHERE "spot_generation_usage"."count" < ${limit}
    RETURNING "count"
  `)
  if (rows.length === 0) return { allowed: false, used: limit }
  return { allowed: true, used: Number(rows[0].count) }
}
