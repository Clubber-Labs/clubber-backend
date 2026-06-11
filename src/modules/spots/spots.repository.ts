import { Prisma } from '@prisma/client'
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
      throw {
        statusCode: 409,
        message: `Limite de ${maxActive} spots ativos atingido`,
      }
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

/** Campos mínimos para autorizar mutação (dono) e checar estado. */
export async function findSpotForMutation(id: string) {
  return prisma.spot.findUnique({
    where: { id },
    select: { id: true, creatorId: true, canceledAt: true },
  })
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

export type SpotMapFilters = {
  bboxNorth: number
  bboxSouth: number
  bboxEast: number
  bboxWest: number
  category?: string[]
  friendsOnly: boolean
  limit: number
}

/**
 * IDs dos spots visíveis dentro da bbox. Filtra no SQL (camada certa): janela
 * ativa, bbox (índice GiST sobre location), interseção de categorias, bloqueio
 * mútuo e visibilidade (público; ou criador; ou FRIENDS via follow mútuo).
 * Viewer anônimo (null) só enxerga PUBLIC e nunca com friendsOnly.
 *
 * "Ativo" = não cancelado E ainda não encerrado (`endsAt > now`) — inclui os
 * que ainda não começaram (upcoming): o objetivo é entrar no chat e COMBINAR
 * antes do rolê. startsAt é só o horário exibido, não um gate de visibilidade.
 */
export async function findSpotIdsInBbox(
  viewerId: string | null,
  filters: SpotMapFilters,
  now: Date,
): Promise<string[]> {
  if (filters.friendsOnly && !viewerId) return []

  const envelope = Prisma.sql`ST_MakeEnvelope(${filters.bboxWest}, ${filters.bboxSouth}, ${filters.bboxEast}, ${filters.bboxNorth}, 4326)::geography`

  const categoryFilter =
    filters.category && filters.category.length > 0
      ? Prisma.sql`AND s.categories && ${filters.category}::"EventCategory"[]`
      : Prisma.empty

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
      AND s.location && ${envelope}
      ${categoryFilter}
      AND ${visibility}
      ${blockExclusion}
    ORDER BY s."createdAt" DESC
    LIMIT ${filters.limit}
  `)
  return rows.map((r) => r.id)
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

export async function findUserIsPremium(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isPremium: true },
  })
  return user?.isPremium ?? false
}

/** Leitura do uso de hoje (CURRENT_DATE), para rejeitar excesso ANTES de chamar
 * o Places. O teto real é garantido pelo consumeGenerationQuota (atômico). */
export async function findTodayGenerationCount(
  userId: string,
): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: number }[]>(Prisma.sql`
    SELECT "count" FROM "spot_generation_usage"
    WHERE "userId" = ${userId} AND "day" = CURRENT_DATE
  `)
  return rows.length > 0 ? Number(rows[0].count) : 0
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
