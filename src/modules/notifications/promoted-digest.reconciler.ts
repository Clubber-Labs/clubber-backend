import { Prisma } from '@prisma/client'
import { env } from '../../lib/env'
import { logger } from '../../lib/logger'
import { prisma } from '../../lib/prisma'
import { realtime } from '../../lib/realtime'
import {
  createManyNotifications,
  findNotificationsForEvent,
} from './notification.repository'
import { sendPushBatch } from './notification-push.service'
import { buildPushData, shapeNotification } from './notification-shape'

const digestLog = logger.child({ component: 'promoted-digest' })

const MS_PER_DAY = 86_400_000
// Over-notify da borda do geohash (espelha proximity.repository).
const CELL_HALF_DIAGONAL_M = 700

// dedupeKey de promoção: distinto do EVENT_NEARBY de criação
// (`EVENT_NEARBY::<eventId>::`) e prefixo estável p/ o cooldown via LIKE.
export function promotedDedupeKey(eventId: string): string {
  return `EVENT_NEARBY:promoted:${eventId}`
}

type DigestRow = { userId: string; eventId: string }

/**
 * Digest "melhor pra você": para cada usuário ELEGÍVEL e fora de COOLDOWN,
 * escolhe o melhor evento promovido (isFeatured) dentro do raio dele e envia
 * UMA notificação curada. O volume é por usuário, não por promoção — N
 * promovidos na região ainda resultam em 1 push por pessoa por período.
 *
 * Elegibilidade (espelha a query invertida de proximidade): conta ACTIVE,
 * consentimento push + locationPrecise não revogado, localização fresca,
 * ativo recentemente (lastSeenAt). Cooldown: nenhuma notificação de promoção
 * nos últimos PROMOTION_DIGEST_COOLDOWN_DAYS.
 *
 * Relevância (LATERAL top-1 por usuário): casa categoria preferida primeiro,
 * depois o mais próximo, depois o de maior engajamento.
 *
 * Exclusões por (usuário, evento): evento próprio, já notificado deste evento
 * (criação OU promoção — idempotência), presença já registrada, bloqueio
 * entre as partes.
 */
export async function runPromotedDigest(
  now = new Date(),
): Promise<{ notified: number }> {
  try {
    // Promovidos vivos (janela ativa via flag isFeatured, mantida pelo
    // reconciler do featured-events) e ainda não terminados.
    const promoted = await prisma.event.findMany({
      where: {
        isFeatured: true,
        isPublic: true,
        canceledAt: null,
      },
      select: { id: true, title: true, date: true, endDate: true },
    })
    const alive = promoted.filter((e) => {
      const end = e.endDate ?? new Date(e.date.getTime() + 4 * 3600_000)
      return end.getTime() > now.getTime()
    })
    if (alive.length === 0) return { notified: 0 }

    const titleByEvent = new Map(alive.map((e) => [e.id, e.title]))
    const promotedIds = alive.map((e) => e.id)

    const locationCutoff = new Date(
      now.getTime() - env.NOTIFY_LOCATION_TTL_DAYS * MS_PER_DAY,
    )
    const activeCutoff = new Date(
      now.getTime() - env.PROMOTION_DIGEST_ACTIVE_USER_DAYS * MS_PER_DAY,
    )
    const cooldownCutoff = new Date(
      now.getTime() - env.PROMOTION_DIGEST_COOLDOWN_DAYS * MS_PER_DAY,
    )
    const batchSize = env.NOTIFY_FANOUT_BATCH_SIZE

    let cursorId: string | undefined
    let notified = 0
    let evaluatedBatches = 0

    while (true) {
      const cursor = cursorId
        ? Prisma.sql`AND u.id > ${cursorId}`
        : Prisma.empty

      // Top-1 promovido por usuário via LATERAL. O JOIN implícito do LATERAL
      // já descarta usuários sem nenhum promovido elegível no raio.
      const rows = await prisma.$queryRaw<DigestRow[]>(Prisma.sql`
        SELECT u.id AS "userId", best.event_id AS "eventId"
        FROM users u
        JOIN user_consents c ON c."userId" = u.id
        CROSS JOIN LATERAL (
          SELECT e.id AS event_id
          FROM events e
          WHERE e.id IN (${Prisma.join(promotedIds)})
            AND e."authorId" <> u.id
            AND ST_DWithin(
              u.location,
              e.location,
              LEAST(u."notifyRadiusKm", ${env.NOTIFY_MAX_RADIUS_KM}) * 1000
                + ${CELL_HALF_DIAGONAL_M}
            )
            AND NOT EXISTS (
              SELECT 1 FROM notifications n
              WHERE n."userId" = u.id AND n."eventId" = e.id
            )
            AND NOT EXISTS (
              SELECT 1 FROM event_attendances a
              WHERE a."userId" = u.id AND a."eventId" = e.id
            )
            AND NOT EXISTS (
              SELECT 1 FROM blocks b
              WHERE (b."blockerId" = u.id AND b."blockedId" = e."authorId")
                 OR (b."blockerId" = e."authorId" AND b."blockedId" = u.id)
            )
          ORDER BY
            EXISTS (
              SELECT 1 FROM user_category_preferences p
              WHERE p."userId" = u.id AND p.category = ANY(e.categories)
            ) DESC,
            ST_Distance(u.location, e.location) ASC,
            (SELECT count(*) FROM event_attendances a2
              WHERE a2."eventId" = e.id) DESC,
            e.id ASC
          LIMIT 1
        ) best
        WHERE u."accountStatus" = 'ACTIVE'
          AND u.location IS NOT NULL
          AND u."locationUpdatedAt" > ${locationCutoff}
          AND u."lastSeenAt" > ${activeCutoff}
          AND c."pushNotifications" = true
          AND c."locationPrecise" = true
          AND c."revokedAt" IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM notifications n2
            WHERE n2."userId" = u.id
              AND n2."dedupeKey" LIKE 'EVENT_NEARBY:promoted:%'
              AND n2."createdAt" > ${cooldownCutoff}
          )
          ${cursor}
        ORDER BY u.id
        LIMIT ${batchSize}
      `)
      if (rows.length === 0) break
      cursorId = rows[rows.length - 1].userId
      evaluatedBatches++

      // Agrupa por evento pra reusar o caminho de entrega por-evento do fan-out.
      const byEvent = new Map<string, string[]>()
      for (const r of rows) {
        const list = byEvent.get(r.eventId) ?? []
        list.push(r.userId)
        byEvent.set(r.eventId, list)
      }

      for (const [eventId, userIds] of byEvent) {
        await createManyNotifications(
          userIds.map((userId) => ({
            userId,
            type: 'EVENT_NEARBY' as const,
            eventId,
            title: 'Em destaque perto de você',
            body: titleByEvent.get(eventId) ?? 'Evento em destaque',
            data: { eventId },
            dedupeKey: promotedDedupeKey(eventId),
          })),
        )

        // A exclusão por (usuário, evento) na query garante que as únicas
        // notificações destes usuários para este evento são as recém-criadas.
        const created = await findNotificationsForEvent(
          userIds,
          eventId,
          'EVENT_NEARBY',
        )
        await Promise.all(
          created.map((n) =>
            realtime.publishNotification({
              type: 'notification',
              recipientId: n.userId,
              notification: shapeNotification(n),
            }),
          ),
        )
        await sendPushBatch(
          created.map((n) => ({
            userId: n.userId,
            content: {
              title: n.title,
              body: n.body,
              data: buildPushData(n),
            },
          })),
        )
        notified += created.length
      }

      if (rows.length < batchSize) break
    }

    digestLog.info(
      { notified, promoted: alive.length, batches: evaluatedBatches },
      'promoted digest concluído',
    )
    return { notified }
  } catch (err) {
    digestLog.warn({ err }, 'promoted digest falhou')
    return { notified: 0 }
  }
}

let timer: NodeJS.Timeout | null = null
let isRunning = false

export function startPromotedDigestReconciler(intervalMs: number) {
  digestLog.info({ intervalMs }, 'Starting promoted digest reconciler')
  if (timer) return
  timer = setInterval(() => {
    if (isRunning) return
    isRunning = true
    runPromotedDigest()
      .catch((err) => {
        digestLog.error({ err }, 'promoted digest reconciliation failed')
      })
      .finally(() => {
        isRunning = false
      })
  }, intervalMs)
  timer.unref?.()
}

export function stopPromotedDigestReconciler() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
