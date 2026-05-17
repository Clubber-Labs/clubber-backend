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
 * Cobre apenas segurança/visibilidade do autor — lifecycle (canceledAt,
 * status) fica no Prisma WHERE do caller, que precisa respeitar o que
 * o usuário pediu (ex: ?status=CANCELED).
 *
 * Espera que a query tenha aliased `events e` e `users a` via JOIN.
 */
function visibilityPredicate(viewerId?: string) {
  const authorOk = viewerId
    ? Prisma.sql`(a."isPrivate" = false OR a.id = ${viewerId} OR EXISTS (
        SELECT 1 FROM follows f
        WHERE f."followerId" = ${viewerId}
          AND f."followingId" = a.id
          AND f.status = 'ACCEPTED'
      ))`
    : Prisma.sql`a."isPrivate" = false`
  return Prisma.sql`
    e."isPublic" = true
    AND ${authorOk}
  `
}

export async function findEventIdsInBbox(
  bbox: Bbox,
  limit?: number,
  viewerId?: string,
): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`
      SELECT e.id FROM events e
      INNER JOIN users a ON a.id = e."authorId"
      WHERE ${visibilityPredicate(viewerId)}
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
  viewerId?: string,
): Promise<string[]> {
  const radiusMeters = radiusKm * 1000
  const rows = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`
      SELECT e.id FROM events e
      INNER JOIN users a ON a.id = e."authorId"
      WHERE ${visibilityPredicate(viewerId)}
        AND ST_DWithin(
          e.location,
          ST_SetSRID(ST_MakePoint(${center.longitude}, ${center.latitude}), 4326)::geography,
          ${radiusMeters}
        )
    `,
  )
  return rows.map((r) => r.id)
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
