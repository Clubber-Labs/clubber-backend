import { Prisma } from '@prisma/client'
import type { EventCategory } from '../../lib/event-categories'
import { prisma } from '../../lib/prisma'

// NOTA DE LOCALIZAÇÃO: as queries de lib/spatial.ts são primitivas geométricas
// reutilizáveis sobre EVENTOS (bbox/raio/KNN). Esta é uma query de DOMÍNIO de
// notificação — o PostGIS é só um predicado entre joins de consentimento,
// categoria e bloqueio. Fica no módulo de propósito (coesão), não em spatial.ts.

// Over-notify: meia-diagonal da célula geohash precisão 6 (~0.7km). Somada ao
// raio no refino, garante que nunca silenciamos quem está dentro — só falsos
// positivos na borda (decisão de produto).
const CELL_HALF_DIAGONAL_M = 700

export type ProximityTarget = {
  longitude: number
  latitude: number
  categories: EventCategory[]
  /** Tags finas do evento/spot (subcategorias de venue + gêneros). Pode ser []. */
  subcategories: string[]
  authorId: string
}

/**
 * Predicado de preferência de 2 níveis: o usuário prefere AO MENOS UMA das
 * categorias OU AO MENOS UMA das subcategorias do evento/spot. Espelha o match
 * hierárquico do feed (categoria cobre o grosso; subcategoria refina). Quando o
 * alvo não tem subcategoria, o ramo fino vira FALSE (cai só na categoria) —
 * evitando a ambiguidade de `= ANY('{}')` com array vazio.
 */
function preferenceMatch(target: ProximityTarget): Prisma.Sql {
  const catPref = Prisma.sql`EXISTS (
        SELECT 1 FROM user_category_preferences ucp
        WHERE ucp."userId" = u.id
          AND ucp.category::text = ANY(${target.categories})
      )`
  const subPref =
    target.subcategories.length > 0
      ? Prisma.sql`EXISTS (
        SELECT 1 FROM user_subcategory_preferences usp
        WHERE usp."userId" = u.id
          AND usp.subcategory = ANY(${target.subcategories})
      )`
      : Prisma.sql`FALSE`
  return Prisma.sql`(${catPref} OR ${subPref})`
}

export type ProximityScan = {
  /** Teto do raio = constante do pré-filtro indexável (GiST). */
  maxRadiusKm: number
  /** Janela de frescor da localização do usuário. */
  ttlDays: number
  limit: number
  /** Keyset: retorna só ids > cursorId (paginação do fan-out). */
  cursorId?: string
}

/**
 * Query INVERTIDA: dado um evento (ponto + categoria + autor), devolve os ids
 * dos usuários que devem receber `EVENT_NEARBY`. Paginada por keyset (u.id) para
 * o fan-out em lotes (entrega 5).
 *
 * Pré-filtro `ST_DWithin` com raio MÁXIMO constante usa o índice GiST
 * (users_location_idx) e corta a tabela; o refino por linha
 * (`ST_Distance <= notifyRadiusKm*1000 + meia-diagonal`) roda só sobre os
 * candidatos — padrão "filtro na camada certa" do CLAUDE.md. Demais predicados:
 * freshness (TTL), consentimento (push + locationPrecise, não revogado),
 * preferência de 2 níveis (o usuário prefere AO MENOS UMA categoria OU
 * subcategoria do evento — ver preferenceMatch), conta ativa, não-autor e sem
 * bloqueio entre as partes (espelha a exclusão de bloqueio do chat.repository).
 */
export async function findUsersToNotifyNearEvent(
  target: ProximityTarget,
  scan: ProximityScan,
): Promise<string[]> {
  const point = Prisma.sql`ST_SetSRID(ST_MakePoint(${target.longitude}, ${target.latitude}), 4326)::geography`
  const cursor = scan.cursorId
    ? Prisma.sql`AND u.id > ${scan.cursorId}`
    : Prisma.empty

  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT u.id
    FROM users u
    JOIN user_consents c ON c."userId" = u.id
    WHERE u.location IS NOT NULL
      AND ST_DWithin(u.location, ${point}, ${scan.maxRadiusKm * 1000})
      AND ST_Distance(u.location, ${point}) <= u."notifyRadiusKm" * 1000 + ${CELL_HALF_DIAGONAL_M}
      AND u."locationUpdatedAt" > now() - (${scan.ttlDays} * interval '1 day')
      AND u."accountStatus" = 'ACTIVE'
      AND u.id <> ${target.authorId}
      AND c."revokedAt" IS NULL
      AND c."pushNotifications" = true
      AND c."locationPrecise" = true
      AND ${preferenceMatch(target)}
      AND NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b."blockerId" = u.id AND b."blockedId" = ${target.authorId})
           OR (b."blockerId" = ${target.authorId} AND b."blockedId" = u.id)
      )
      ${cursor}
    ORDER BY u.id
    LIMIT ${scan.limit}
  `)
  return rows.map((r) => r.id)
}

export type SpotProximityTarget = ProximityTarget & {
  /** PUBLIC notifica qualquer um perto; FRIENDS só follow mútuo do criador. */
  visibility: 'PUBLIC' | 'FRIENDS'
}

/**
 * Versão de spot da query invertida: igual ao evento (proximidade + preferência
 * de 2 níveis + consentimento + bloqueio), MAIS o filtro de visibilidade — spot
 * FRIENDS só alcança quem segue mutuamente o criador. `authorId` = criador.
 */
export async function findUsersToNotifyNearSpot(
  target: SpotProximityTarget,
  scan: ProximityScan,
  // discovery = alcance premium: inverte a preferência (quem NÃO prefere a
  // categoria). O cap de frequência é aplicado pelo caller.
  opts: { discovery?: boolean } = {},
): Promise<string[]> {
  const point = Prisma.sql`ST_SetSRID(ST_MakePoint(${target.longitude}, ${target.latitude}), 4326)::geography`
  const cursor = scan.cursorId
    ? Prisma.sql`AND u.id > ${scan.cursorId}`
    : Prisma.empty
  // discovery inverte a preferência de 2 níveis: alcança quem NÃO prefere nem a
  // categoria nem a subcategoria do spot (alcance premium fora do gosto).
  const match = preferenceMatch(target)
  const preference = opts.discovery
    ? Prisma.sql`AND NOT ${match}`
    : Prisma.sql`AND ${match}`
  const visibility =
    target.visibility === 'FRIENDS'
      ? Prisma.sql`AND EXISTS (
          SELECT 1 FROM follows f1
          JOIN follows f2
            ON f2."followerId" = u.id
           AND f2."followingId" = ${target.authorId}
           AND f2.status = 'ACCEPTED'
          WHERE f1."followerId" = ${target.authorId}
            AND f1."followingId" = u.id
            AND f1.status = 'ACCEPTED'
        )`
      : Prisma.empty

  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT u.id
    FROM users u
    JOIN user_consents c ON c."userId" = u.id
    WHERE u.location IS NOT NULL
      AND ST_DWithin(u.location, ${point}, ${scan.maxRadiusKm * 1000})
      AND ST_Distance(u.location, ${point}) <= u."notifyRadiusKm" * 1000 + ${CELL_HALF_DIAGONAL_M}
      AND u."locationUpdatedAt" > now() - (${scan.ttlDays} * interval '1 day')
      AND u."accountStatus" = 'ACTIVE'
      AND u.id <> ${target.authorId}
      AND c."revokedAt" IS NULL
      AND c."pushNotifications" = true
      AND c."locationPrecise" = true
      ${preference}
      AND NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b."blockerId" = u.id AND b."blockedId" = ${target.authorId})
           OR (b."blockerId" = ${target.authorId} AND b."blockedId" = u.id)
      )
      ${visibility}
      ${cursor}
    ORDER BY u.id
    LIMIT ${scan.limit}
  `)
  return rows.map((r) => r.id)
}
