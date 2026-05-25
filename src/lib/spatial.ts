import { Prisma } from '@prisma/client'
import {
  DEFAULT_DURATION_MS,
  type EventStatus,
  SOON_THRESHOLD_MS,
} from './event-lifecycle'
import { prisma } from './prisma'

export type Bbox = {
  north: number
  south: number
  east: number
  west: number
}

export type LatLng = { latitude: number; longitude: number }

/**
 * Cap defensivo da busca-por-raio sem ordenação. Sem isso, um raio amplo
 * (50 km no centro de SP) pode casar dezenas de milhares de eventos e a
 * query Prisma subsequente vira `id IN (...)` gigante — viola RNF01.3
 * (busca p95 ≤ 1 s).
 *
 * O cap conta sobre o conjunto FILTRADO (visibilidade + lifecycle + categoria
 * + data), não sobre o raio bruto: senão `radius=1001 brutos` mas
 * `categoria=música → 30` retornaria 400 falso.
 */
export const RADIUS_MAX_RESULTS = 1000

/**
 * Snap de coordenadas a uma grade de ~110m (3 casas decimais). Usuários
 * próximos caem na mesma célula → compartilham a entrada de cache, o que
 * destrava o hit-rate da busca por proximidade (RNF05.2). O snap afeta a
 * ordenação e a chave de cache; no filtro por `radiusKm` aceita-se tolerância
 * de borda de até ~156m (diagonal da célula) — "raio" é intenção difusa
 * ("perto de mim") e o próprio GPS erra mais que isso.
 */
export function snapToGrid(
  lat: number,
  lng: number,
  decimals = 3,
): { lat: number; lng: number } {
  const f = 10 ** decimals
  return { lat: Math.round(lat * f) / f, lng: Math.round(lng * f) / f }
}

export type DistanceCursor = { dist: number; id: string }

export type EventDistanceRow = { id: string; dist: number }

/**
 * Filtros secundários aplicados DENTRO da SQL espacial (não depois, no Prisma).
 * Empurrar pro SQL garante que cap/limite/keyset operem sobre o conjunto real
 * da busca — evita página incompleta e 400 falso.
 */
export type SpatialFilters = {
  category?: string[]
  dateFrom?: Date
  dateTo?: Date
  status?: EventStatus[]
  includePast?: boolean
  now?: Date
}

/**
 * Predicado SQL de visibilidade aplicado dentro das queries espaciais.
 * Filtra antes do LIMIT/ORDER para garantir que o cap espacial nunca
 * exclui eventos visíveis em favor de invisíveis.
 *
 * Usa SÓ colunas do `events` (incl. `authorIsPrivate` denormalizado) — sem
 * JOIN com `users`. Crucial: o JOIN derrubava o index-scan KNN do GiST
 * (forçava seq-scan + sort de ~80k linhas → 138ms); sem ele o caminho anônimo
 * volta ao índice (~1ms). O ramo autenticado ainda toca `follows` (cross-table,
 * via EXISTS) — minoria e cacheado por viewer.
 */
function visibilityPredicate(viewerId?: string) {
  const authorOk = viewerId
    ? Prisma.sql`(e."authorIsPrivate" = false OR e."authorId" = ${viewerId} OR EXISTS (
        SELECT 1 FROM follows f
        WHERE f."followerId" = ${viewerId}
          AND f."followingId" = e."authorId"
          AND f.status = 'ACCEPTED'
      ))`
    : Prisma.sql`e."authorIsPrivate" = false`
  return Prisma.sql`
    e."isPublic" = true
    AND ${authorOk}
  `
}

/**
 * Condição SQL de um status de ciclo de vida — espelha `statusConditionFor`
 * de event-filters.ts (camada Prisma). A paridade entre as duas é coberta
 * por teste (events.test.ts), já que a lógica é duplicada em SQL aqui.
 */
function statusSqlCondition(
  status: EventStatus,
  now: Date,
  soonBoundary: Date,
  pastBoundary: Date,
): Prisma.Sql {
  switch (status) {
    case 'CANCELED':
      return Prisma.sql`e."canceledAt" IS NOT NULL`
    case 'PAST':
      return Prisma.sql`(e."canceledAt" IS NULL AND (e."endDate" <= ${now} OR (e."endDate" IS NULL AND e.date <= ${pastBoundary})))`
    case 'ONGOING':
      return Prisma.sql`(e."canceledAt" IS NULL AND e.date <= ${now} AND (e."endDate" > ${now} OR (e."endDate" IS NULL AND e.date > ${pastBoundary})))`
    case 'SOON':
      return Prisma.sql`(e."canceledAt" IS NULL AND e.date > ${now} AND e.date <= ${soonBoundary})`
    case 'UPCOMING':
      return Prisma.sql`(e."canceledAt" IS NULL AND e.date > ${soonBoundary})`
  }
}

/**
 * Predicado SQL de lifecycle — espelha `buildLifecycleWhere` (Prisma).
 * - Com `status`: OR entre as condições de cada status pedido.
 * - Sem `status`: exclui cancelados; se `!includePast`, exclui passados.
 */
function lifecycleSqlPredicate(
  status: EventStatus[] | undefined,
  includePast: boolean,
  now: Date,
): Prisma.Sql {
  const soonBoundary = new Date(now.getTime() + SOON_THRESHOLD_MS)
  const pastBoundary = new Date(now.getTime() - DEFAULT_DURATION_MS)

  if (status && status.length > 0) {
    const conds = status.map((s) =>
      statusSqlCondition(s, now, soonBoundary, pastBoundary),
    )
    return Prisma.sql`(${Prisma.join(conds, ' OR ')})`
  }

  if (includePast) return Prisma.sql`e."canceledAt" IS NULL`

  return Prisma.sql`e."canceledAt" IS NULL AND (e."endDate" > ${now} OR (e."endDate" IS NULL AND e.date > ${pastBoundary}))`
}

/**
 * Filtros secundários (lifecycle + categoria + intervalo de data) como uma
 * única `Prisma.Sql` AND-junta, pronta pra entrar no WHERE espacial.
 */
function spatialFiltersPredicate(filters: SpatialFilters): Prisma.Sql {
  const now = filters.now ?? new Date()
  const conds: Prisma.Sql[] = [
    lifecycleSqlPredicate(filters.status, filters.includePast ?? false, now),
  ]
  if (filters.category && filters.category.length > 0) {
    conds.push(Prisma.sql`e.category IN (${Prisma.join(filters.category)})`)
  }
  if (filters.dateFrom !== undefined) {
    conds.push(Prisma.sql`e.date >= ${filters.dateFrom}`)
  }
  if (filters.dateTo !== undefined) {
    conds.push(Prisma.sql`e.date <= ${filters.dateTo}`)
  }
  return Prisma.join(conds, ' AND ')
}

export async function findEventIdsInBbox(
  bbox: Bbox,
  limit?: number,
  viewerId?: string,
): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`
      SELECT e.id FROM events e      WHERE ${visibilityPredicate(viewerId)}
        AND e.location && ST_MakeEnvelope(${bbox.west}, ${bbox.south}, ${bbox.east}, ${bbox.north}, 4326)::geography
      ORDER BY e."createdAt" DESC
      ${limit ? Prisma.sql`LIMIT ${limit}` : Prisma.empty}
    `,
  )
  return rows.map((r) => r.id)
}

/**
 * IDs de eventos dentro do raio, JÁ filtrados (visibilidade + lifecycle +
 * categoria + data) no SQL. Cap em RADIUS_MAX_RESULTS sobre o conjunto
 * filtrado: se estourar, throw 400 instruindo a refinar (em vez de truncar
 * em silêncio e fingir que o usuário viu o conjunto inteiro).
 */
export async function findEventIdsWithinRadius(
  center: LatLng,
  radiusKm: number,
  filters: SpatialFilters = {},
  viewerId?: string,
): Promise<string[]> {
  const radiusMeters = radiusKm * 1000
  const point = Prisma.sql`ST_SetSRID(ST_MakePoint(${center.longitude}, ${center.latitude}), 4326)::geography`
  // Fetch cap+1 pra detectar "estourou" sem COUNT separado.
  const rows = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`
      SELECT e.id FROM events e      WHERE ${visibilityPredicate(viewerId)}
        AND ${spatialFiltersPredicate(filters)}
        AND ST_DWithin(e.location, ${point}, ${radiusMeters})
      LIMIT ${RADIUS_MAX_RESULTS + 1}
    `,
  )
  if (rows.length > RADIUS_MAX_RESULTS) {
    throw {
      statusCode: 400,
      message: `Raio muito amplo: mais de ${RADIUS_MAX_RESULTS} eventos correspondem. Refine os filtros (categoria, data ou raio menor).`,
    }
  }
  return rows.map((r) => r.id)
}

/**
 * Distância em metros do `center` a cada evento da lista. Roda só sobre os ids
 * já filtrados (não varre a tabela). Eventos sem linha ficam de fora do Map.
 */
export async function findDistancesForEvents(
  center: LatLng,
  eventIds: string[],
): Promise<Map<string, number>> {
  if (eventIds.length === 0) return new Map()
  const point = Prisma.sql`ST_SetSRID(ST_MakePoint(${center.longitude}, ${center.latitude}), 4326)::geography`
  const rows = await prisma.$queryRaw<{ id: string; distance: number }[]>(
    Prisma.sql`
      SELECT e.id, ST_Distance(e.location, ${point}) AS distance
      FROM events e
      WHERE e.id IN (${Prisma.join(eventIds)})
    `,
  )
  return new Map(rows.map((r) => [r.id, Number(r.distance)]))
}

export async function findEventIdsByDistance(
  center: LatLng,
  limit: number,
  radiusKm?: number,
  viewerId?: string,
): Promise<string[]> {
  const point = Prisma.sql`ST_SetSRID(ST_MakePoint(${center.longitude}, ${center.latitude}), 4326)::geography`
  const whereRadius =
    radiusKm !== undefined
      ? Prisma.sql`AND ST_DWithin(e.location, ${point}, ${radiusKm * 1000})`
      : Prisma.empty
  const rows = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`
      SELECT e.id FROM events e
      INNER JOIN users a ON a.id = e."authorId"
      WHERE ${visibilityPredicate(viewerId)}
      ${whereRadius}
      ORDER BY e.location <-> ${point}
      LIMIT ${limit}
    `,
  )
  return rows.map((r) => r.id)
}

/**
 * KNN ordenado por distância, com paginação keyset estável.
 *
 * - Uma única expressão de distância `e.location <-> point` no SELECT, no
 *   keyset (WHERE) e no ORDER BY — `<->` em geography retorna metros e ativa
 *   o índice GiST KNN; misturar com `ST_Distance` divergiria em quase-empates.
 * - Filtros (lifecycle/categoria/data) e visibilidade vão no WHERE: o KNN
 *   devolve exatamente `limit` IDs já filtrados (sem página incompleta).
 * - Cursor `(dist, id)` avança estritamente: `dist > prev OR (= AND id > prev)`.
 *   Estável quando dois eventos têm distância idêntica.
 */
export async function findEventIdsByDistanceKeyset(opts: {
  center: LatLng
  limit: number
  radiusKm?: number
  after?: DistanceCursor
  filters?: SpatialFilters
  viewerId?: string
}): Promise<EventDistanceRow[]> {
  const { center, limit, radiusKm, after, filters = {}, viewerId } = opts
  const point = Prisma.sql`ST_SetSRID(ST_MakePoint(${center.longitude}, ${center.latitude}), 4326)::geography`

  const conditions: Prisma.Sql[] = [
    visibilityPredicate(viewerId),
    spatialFiltersPredicate(filters),
  ]
  if (radiusKm !== undefined) {
    conditions.push(
      Prisma.sql`ST_DWithin(e.location, ${point}, ${radiusKm * 1000})`,
    )
  }
  if (after !== undefined) {
    conditions.push(
      Prisma.sql`((e.location <-> ${point}) > ${after.dist}
                  OR ((e.location <-> ${point}) = ${after.dist} AND e.id > ${after.id}))`,
    )
  }

  // ORDER BY só por distância (sem `, id`): preserva o index-scan KNN do GiST
  // (um 2º critério forçaria sort de ~80k linhas). O tiebreak por id fica no
  // WHERE do cursor (de-dup ao paginar); em empate de coordenada EXATA a ordem
  // entre eles é não-determinística — aceitável num feed "perto de mim".
  const rows = await prisma.$queryRaw<{ id: string; dist: number }[]>(
    Prisma.sql`
      SELECT e.id, (e.location <-> ${point}) AS dist
      FROM events e
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY e.location <-> ${point}
      LIMIT ${limit}
    `,
  )
  return rows.map((r) => ({ id: r.id, dist: Number(r.dist) }))
}

/**
 * Cursor opaco (base64url do JSON). Cliente não interpreta — só repassa.
 * Pequeno (~60 chars) e URL-safe.
 */
export function encodeDistanceCursor(c: DistanceCursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url')
}

export function decodeDistanceCursor(s: string): DistanceCursor | null {
  try {
    const decoded = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'))
    if (
      typeof decoded === 'object' &&
      decoded !== null &&
      typeof decoded.dist === 'number' &&
      Number.isFinite(decoded.dist) &&
      typeof decoded.id === 'string' &&
      decoded.id.length > 0
    ) {
      return { dist: decoded.dist, id: decoded.id }
    }
    return null
  } catch {
    return null
  }
}

export type PopularityCursor = { score: number; id: string }

export type EventPopularityRow = { id: string; score: number }

/**
 * Ranking por popularidade com paginação keyset (RF07.6).
 *
 * score = Σ(CONFIRMED·2 + INTERESTED·1) — só a parte de ENGAJAMENTO da
 * fórmula do heatmap (`findEventsForMap`), deliberadamente SEM o
 * STATUS_HEATMAP_BOOST (esse boost é concern de renderização do mapa: dá calor
 * a ONGOING/SOON; aqui distorceria o ranking de popularidade). Agregado em SQL
 * (LEFT JOIN + GROUP BY); o keyset `(score DESC, id ASC)` vai no HAVING porque
 * score é agregado (não pode ir no WHERE). Visibilidade/lifecycle/categoria/
 * data e o raio opcional reusam os predicados espaciais. `limit` exato (o
 * caller pede limit+1 pra detectar próxima página sem cursor falso).
 */
export async function findEventIdsByPopularityKeyset(opts: {
  limit: number
  after?: PopularityCursor
  center?: LatLng
  radiusKm?: number
  filters?: SpatialFilters
  viewerId?: string
}): Promise<EventPopularityRow[]> {
  const { limit, after, center, radiusKm, filters = {}, viewerId } = opts

  const where: Prisma.Sql[] = [
    visibilityPredicate(viewerId),
    spatialFiltersPredicate(filters),
  ]
  if (radiusKm !== undefined && center !== undefined) {
    const point = Prisma.sql`ST_SetSRID(ST_MakePoint(${center.longitude}, ${center.latitude}), 4326)::geography`
    where.push(Prisma.sql`ST_DWithin(e.location, ${point}, ${radiusKm * 1000})`)
  }

  const score = Prisma.sql`COALESCE(SUM(CASE WHEN att.type = 'CONFIRMED' THEN 2 WHEN att.type = 'INTERESTED' THEN 1 ELSE 0 END), 0)`
  const having =
    after !== undefined
      ? Prisma.sql`HAVING (${score} < ${after.score} OR (${score} = ${after.score} AND e.id > ${after.id}))`
      : Prisma.empty

  const rows = await prisma.$queryRaw<{ id: string; score: number | bigint }[]>(
    Prisma.sql`
      SELECT e.id, ${score} AS score
      FROM events e      LEFT JOIN event_attendances att ON att."eventId" = e.id
      WHERE ${Prisma.join(where, ' AND ')}
      GROUP BY e.id
      ${having}
      ORDER BY score DESC, e.id ASC
      LIMIT ${limit}
    `,
  )
  return rows.map((r) => ({ id: r.id, score: Number(r.score) }))
}

export function encodePopularityCursor(c: PopularityCursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url')
}

export function decodePopularityCursor(s: string): PopularityCursor | null {
  try {
    const decoded = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'))
    if (
      typeof decoded === 'object' &&
      decoded !== null &&
      typeof decoded.score === 'number' &&
      Number.isFinite(decoded.score) &&
      typeof decoded.id === 'string' &&
      decoded.id.length > 0
    ) {
      return { score: decoded.score, id: decoded.id }
    }
    return null
  } catch {
    return null
  }
}
