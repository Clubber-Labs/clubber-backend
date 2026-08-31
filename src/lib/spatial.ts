import { Prisma } from '@prisma/client'
import { prisma } from './prisma'

export type Bbox = {
  north: number
  south: number
  east: number
  west: number
}

export type LatLng = { latitude: number; longitude: number }

/**
 * Predicado SQL de visibilidade aplicado dentro das queries espaciais.
 * Filtra antes do LIMIT/ORDER para garantir que o cap espacial nunca
 * exclui eventos visíveis em favor de invisíveis.
 *
 * No modelo híbrido, evento público é descobrível por qualquer um: a
 * privacidade do PERFIL do autor só protege a aba de eventos do próprio
 * perfil (findEventsByAuthor), nunca a descoberta global (lista/mapa/feed).
 * Aqui basta `isPublic`. Lifecycle (canceledAt, status) fica no Prisma WHERE
 * do caller, que precisa respeitar o que o usuário pediu (ex: ?status=CANCELED).
 */
function visibilityPredicate() {
  return Prisma.sql`e."isPublic" = true`
}

export async function findEventIdsInBbox(
  bbox: Bbox,
  limit?: number,
): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`
      SELECT e.id FROM events e
      WHERE ${visibilityPredicate()}
        AND e.location && ST_MakeEnvelope(${bbox.west}, ${bbox.south}, ${bbox.east}, ${bbox.north}, 4326)::geography
      ORDER BY e."createdAt" DESC
      ${limit ? Prisma.sql`LIMIT ${limit}` : Prisma.empty}
    `,
  )
  return rows.map((r) => r.id)
}

export async function findEventIdsWithinRadius(
  center: LatLng,
  radiusKm: number,
): Promise<string[]> {
  const radiusMeters = radiusKm * 1000
  const rows = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`
      SELECT e.id FROM events e
      WHERE ${visibilityPredicate()}
        AND ST_DWithin(
          e.location,
          ST_SetSRID(ST_MakePoint(${center.longitude}, ${center.latitude}), 4326)::geography,
          ${radiusMeters}
        )
    `,
  )
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

/**
 * Distância haversine em metros — para poucos pontos já carregados no app,
 * sem roundtrip SQL (o ST_Distance fica para conjuntos filtrados no banco).
 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const EARTH_RADIUS_M = 6371000
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.latitude - a.latitude)
  const dLng = toRad(b.longitude - a.longitude)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) *
      Math.cos(toRad(b.latitude)) *
      Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(s))
}

export async function findEventIdsByDistance(
  center: LatLng,
  limit: number,
  radiusKm?: number,
): Promise<string[]> {
  const point = Prisma.sql`ST_SetSRID(ST_MakePoint(${center.longitude}, ${center.latitude}), 4326)::geography`
  const whereRadius =
    radiusKm !== undefined
      ? Prisma.sql`AND ST_DWithin(e.location, ${point}, ${radiusKm * 1000})`
      : Prisma.empty
  const rows = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`
      SELECT e.id FROM events e
      WHERE ${visibilityPredicate()}
      ${whereRadius}
      ORDER BY e.location <-> ${point}
      LIMIT ${limit}
    `,
  )
  return rows.map((r) => r.id)
}
