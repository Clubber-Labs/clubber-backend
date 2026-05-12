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
 * IDs de eventos cuja `location` está dentro do bbox.
 * Filtra por isPublic=true e canceledAt=null por padrão.
 */
export async function findEventIdsInBbox(bbox: Bbox): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`
      SELECT id FROM events
      WHERE "isPublic" = true
        AND "canceledAt" IS NULL
        AND location && ST_MakeEnvelope(${bbox.west}, ${bbox.south}, ${bbox.east}, ${bbox.north}, 4326)::geography
    `,
  )
  return rows.map((r) => r.id)
}

/**
 * IDs de eventos cuja `location` está dentro de `radiusKm` do ponto.
 * Filtra por isPublic=true e canceledAt=null.
 */
export async function findEventIdsWithinRadius(
  center: LatLng,
  radiusKm: number,
): Promise<string[]> {
  const radiusMeters = radiusKm * 1000
  const rows = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`
      SELECT id FROM events
      WHERE "isPublic" = true
        AND "canceledAt" IS NULL
        AND ST_DWithin(
          location,
          ST_SetSRID(ST_MakePoint(${center.longitude}, ${center.latitude}), 4326)::geography,
          ${radiusMeters}
        )
    `,
  )
  return rows.map((r) => r.id)
}

/**
 * IDs de eventos ordenados por proximidade ao ponto (KNN via operador <->).
 * Limita a `limit` resultados. Filtra por isPublic=true e canceledAt=null.
 */
export async function findEventIdsByDistance(
  center: LatLng,
  limit: number,
): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`
      SELECT id FROM events
      WHERE "isPublic" = true
        AND "canceledAt" IS NULL
      ORDER BY location <-> ST_SetSRID(ST_MakePoint(${center.longitude}, ${center.latitude}), 4326)::geography
      LIMIT ${limit}
    `,
  )
  return rows.map((r) => r.id)
}
