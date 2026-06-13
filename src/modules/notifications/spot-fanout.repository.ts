import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'

/**
 * Consome 1 do cap diário de DESCOBERTA (notificação SPOT_NEARBY fora da
 * preferência) para vários usuários de uma vez, de forma atômica, e devolve só
 * os que estavam abaixo do cap (foram incrementados). O ON CONFLICT só atualiza
 * enquanto count < cap; quem está no teto não é retornado. Um único statement
 * (sem loop de upsert por destinatário), race-safe.
 */
export async function consumeDiscoveryBudgetBatch(
  userIds: string[],
  cap: number,
): Promise<string[]> {
  if (userIds.length === 0) return []
  const rows = await prisma.$queryRaw<{ userId: string }[]>(Prisma.sql`
    INSERT INTO "spot_discovery_usage" ("userId", "day", "count", "updatedAt")
    SELECT u, CURRENT_DATE, 1, now() FROM unnest(${userIds}::text[]) AS u
    ON CONFLICT ("userId", "day")
    DO UPDATE SET "count" = "spot_discovery_usage"."count" + 1, "updatedAt" = now()
    WHERE "spot_discovery_usage"."count" < ${cap}
    RETURNING "userId"
  `)
  return rows.map((r) => r.userId)
}
