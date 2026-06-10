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
 * Cap pra drain do grupo de empate de distância na borda da página (ver
 * `findEventIdsAtExactDistance`). Coordenadas exatamente iguais entre N
 * eventos quebram o keyset KNN-only — drenamos o grupo todo pra garantir
 * que cursor.id seja o MAX(id) verdadeiro, eliminando dup E skip. Acima
 * disso é patológico (mil eventos no MESMO ponto); aí degradamos pra
 * "paginação imperfeita" em vez de OOM.
 */
export const MAX_TIE_DRAIN = 100

/**
 * Snap de coordenadas a uma grade de ~110m (3 casas decimais). Usuários
 * próximos caem na mesma célula → compartilham a entrada de cache, o que
 * destrava o hit-rate da busca por proximidade (RNF05.2). O snap afeta a
 * ordenação e a chave de cache; no filtro por `radiusKm` aceita-se tolerância
 * de borda de até ~79m (o centro snapado fica a no máximo meia-diagonal da
 * célula do ponto original) — "raio" é intenção difusa ("perto de mim") e o
 * próprio GPS erra mais que isso.
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

// `events.id` é TEXT contendo um UUID canônico (String @id @default(uuid()),
// sem @db.Uuid). Validar o formato no decode rejeita cursor adulterado cedo
// (decode null → 400 "Cursor inválido" no repository) em vez de produzir
// páginas silenciosamente vazias/estranhas com um id malformado.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
    // category é enum "EventCategory" no schema; o cast pra text evita
    // "operator does not exist: EventCategory = text" no raw query.
    conds.push(
      Prisma.sql`e.category::text IN (${Prisma.join(filters.category)})`,
    )
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
 * Página de IDs dentro do raio, JÁ filtrados (visibilidade + lifecycle +
 * categoria + data) no SQL, ordenados por `(isFeatured DESC, date ASC, id ASC)`
 * com paginação keyset — devolve só os `limit (+1)` IDs da página.
 *
 * Por que keyset em vez de "todos os IDs do raio": o caminho antigo buscava o
 * conjunto inteiro (até o cap) e re-ordenava num `findMany IN (...)` gigante no
 * Prisma; sob carga, transferir e re-ordenar centenas de IDs por request
 * inflava o p95 do `radiusKm`. Aqui o trabalho por request espelha o caminho
 * `distance` (keyset → hidrata só a página).
 *
 * Cap de abuso preservado: `total` é contado capado em `RADIUS_MAX_RESULTS + 1`
 * (early-stop), e se o raio filtrado casa mais que `RADIUS_MAX_RESULTS` → 400
 * (mesma mensagem do caminho antigo) em vez de paginar um conjunto absurdo.
 *
 * Cursor: o id da última linha da página (opaco, igual ao feed por data sem
 * raio). Os campos `(isFeatured, date)` do keyset vêm de um lookup do próprio
 * id no mesmo SQL (CTE `cur`) — sem round-trip extra e sem mudar o formato.
 */
export async function findEventIdsWithinRadiusPage(opts: {
  center: LatLng
  radiusKm: number
  limit: number
  cursor?: string
  filters?: SpatialFilters
  viewerId?: string
}): Promise<string[]> {
  const { center, radiusKm, limit, cursor, filters = {}, viewerId } = opts
  const radiusMeters = radiusKm * 1000
  const point = Prisma.sql`ST_SetSRID(ST_MakePoint(${center.longitude}, ${center.latitude}), 4326)::geography`

  const cursorCte =
    cursor !== undefined
      ? Prisma.sql`, cur AS (SELECT "isFeatured" AS f, date AS d FROM events WHERE id = ${cursor})`
      : Prisma.empty
  // Keyset da ordem (isFeatured DESC, date ASC, id ASC): "depois do cursor" é
  // isFeatured menor, OU mesma feature e date maior, OU empate total e id maior.
  const keyset =
    cursor !== undefined
      ? Prisma.sql`AND (
          m."isFeatured" < (SELECT f FROM cur)
          OR (m."isFeatured" = (SELECT f FROM cur) AND m.date > (SELECT d FROM cur))
          OR (m."isFeatured" = (SELECT f FROM cur) AND m.date = (SELECT d FROM cur) AND m.id > ${cursor})
        )`
      : Prisma.empty

  const rows = await prisma.$queryRaw<{ id: string; total: bigint }[]>(
    Prisma.sql`
      WITH matched AS (
        SELECT e.id, e."isFeatured", e.date
        FROM events e
        WHERE ${visibilityPredicate(viewerId)}
          AND ${spatialFiltersPredicate(filters)}
          AND ST_DWithin(e.location, ${point}, ${radiusMeters})
      )${cursorCte}
      SELECT m.id,
        (SELECT count(*) FROM (SELECT 1 FROM matched LIMIT ${RADIUS_MAX_RESULTS + 1}) c) AS total
      FROM matched m
      WHERE TRUE ${keyset}
      ORDER BY m."isFeatured" DESC, m.date ASC, m.id ASC
      LIMIT ${limit + 1}
    `,
  )

  if (rows.length > 0 && Number(rows[0].total) > RADIUS_MAX_RESULTS) {
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
  // Sem JOIN com users: visibilityPredicate usa `e.authorIsPrivate`
  // (denormalizado via trigger) — o JOIN antigo era dead weight que derrubava
  // o index-scan KNN do GiST.
  const rows = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`
      SELECT e.id FROM events e
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
  // (um 2º critério forçaria sort de ~80k linhas). A ordem entre eventos em
  // empate de distância é não-determinística — o consumer dreno o grupo de
  // empate na borda da página (`findEventIdsAtExactDistance`) e usa MAX(id)
  // como cursor pra eliminar dup e skip.
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
 * Drain do grupo de empate de distância exata na borda de uma página KNN.
 *
 * Por que existe: KNN-only (`ORDER BY <->`) sem tiebreak por id tem ordem
 * NÃO-DETERMINÍSTICA entre eventos no MESMO ponto geocodificado. Se a página
 * cortar no meio de um grupo de empate, o cursor `{dist, last.id}` ou pula
 * eventos (id < last.id no grupo) ou repete (id > last.id já visto). Drenar
 * o grupo inteiro na borda + avançar pro `MAX(id)` do grupo elimina os dois.
 *
 * Cap em `MAX_TIE_DRAIN`: pra coords exatamente iguais entre N eventos com
 * N >> 100, voltamos pro modo "paginação imperfeita" em vez de OOM. Em dados
 * reais (geocoder) ties são raros e nunca > algumas unidades; cap é teto
 * defensivo, não regime de operação.
 */
export async function findEventIdsAtExactDistance(opts: {
  center: LatLng
  dist: number
  excludeIds: string[]
  cap?: number
  filters?: SpatialFilters
  viewerId?: string
}): Promise<string[]> {
  const { center, dist, excludeIds, filters = {}, viewerId } = opts
  const cap = opts.cap ?? MAX_TIE_DRAIN
  if (excludeIds.length === 0) return []
  const point = Prisma.sql`ST_SetSRID(ST_MakePoint(${center.longitude}, ${center.latitude}), 4326)::geography`

  const conditions: Prisma.Sql[] = [
    visibilityPredicate(viewerId),
    spatialFiltersPredicate(filters),
    // Bound indexável (GiST) pra não varrer a tabela inteira no drain. O 4º arg
    // `false` (use_spheroid) é OBRIGATÓRIO: casa a esfera do `<->`; o default
    // spheroid divergiria e excluiria linhas do empate exato (reintroduz skip).
    Prisma.sql`ST_DWithin(e.location, ${point}, ${dist}, false)`,
    Prisma.sql`(e.location <-> ${point}) = ${dist}`,
    Prisma.sql`e.id NOT IN (${Prisma.join(excludeIds)})`,
  ]

  const rows = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`
      SELECT e.id
      FROM events e
      WHERE ${Prisma.join(conditions, ' AND ')}
      LIMIT ${cap}
    `,
  )
  return rows.map((r) => r.id)
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
      UUID_RE.test(decoded.id)
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
      UUID_RE.test(decoded.id)
    ) {
      return { score: decoded.score, id: decoded.id }
    }
    return null
  } catch {
    return null
  }
}
