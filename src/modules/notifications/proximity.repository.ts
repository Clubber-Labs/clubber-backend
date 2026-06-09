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
  category: EventCategory
  authorId: string
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
 * categoria preferida explícita, conta ativa, não-autor e sem bloqueio entre as
 * partes (espelha a exclusão de bloqueio do chat.repository).
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
      AND EXISTS (
        SELECT 1 FROM user_category_preferences ucp
        WHERE ucp."userId" = u.id AND ucp.category::text = ${target.category}
      )
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
