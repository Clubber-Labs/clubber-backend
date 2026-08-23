import type { Prisma } from '@prisma/client'
import { env } from '../../lib/env'
import { logger } from '../../lib/logger'
import { findActiveParticipantUserIds } from '../chat/chat.repository'
import { findSpotForFanout } from '../spots/spots.repository'
import {
  createManyNotifications,
  findActorSummary,
  findExistingUserIdsByDedupeKey,
  findNotificationsByDedupeKey,
} from './notification.repository'
import { deliverNotifications } from './notification-delivery'
import { notificationDedupeKey } from './notification-shape'
import { findUsersToNotifyNearSpot } from './proximity.repository'
import { consumeDiscoveryBudgetBatch } from './spot-fanout.repository'

const DISCOVERY_DAILY_CAP = 5

type SpotForFanout = NonNullable<Awaited<ReturnType<typeof findSpotForFanout>>>

/**
 * Loop paginado de SPOT_NEARBY. `discovery=false` = audiência que PREFERE a
 * categoria; `discovery=true` = alcance premium (quem NÃO prefere), limitado
 * pelo cap diário por destinatário. Idempotente por dedupeKey, best-effort.
 */
async function fanOutNearby(
  spot: SpotForFanout,
  dedupeKey: string,
  data: Prisma.InputJsonObject,
  discovery: boolean,
): Promise<number> {
  const target = {
    longitude: spot.longitude,
    latitude: spot.latitude,
    categories: spot.categories,
    subcategories: spot.subcategories,
    authorId: spot.creatorId,
    visibility: spot.visibility,
  }
  const batchSize = env.NOTIFY_FANOUT_BATCH_SIZE
  let cursorId: string | undefined
  let notified = 0

  while (true) {
    const userIds = await findUsersToNotifyNearSpot(
      target,
      {
        maxRadiusKm: env.NOTIFY_MAX_RADIUS_KM,
        ttlDays: env.NOTIFY_LOCATION_TTL_DAYS,
        limit: batchSize,
        cursorId,
      },
      { discovery },
    )
    if (userIds.length === 0) break
    cursorId = userIds[userIds.length - 1]

    const existing = await findExistingUserIdsByDedupeKey(userIds, dedupeKey)
    let recipients = userIds.filter((id) => !existing.has(id))
    // Descoberta: só quem ainda está abaixo do cap diário (consumo atômico).
    if (discovery) {
      recipients = await consumeDiscoveryBudgetBatch(
        recipients,
        DISCOVERY_DAILY_CAP,
      )
    }

    if (recipients.length > 0) {
      await createManyNotifications(
        recipients.map((userId) => ({
          userId,
          type: 'SPOT_NEARBY' as const,
          spotId: spot.id,
          params: { spotTitle: spot.title },
          data,
          dedupeKey,
        })),
      )
      const created = await findNotificationsByDedupeKey(recipients, dedupeKey)
      await deliverNotifications(created)
      notified += created.length
    }

    if (userIds.length < batchSize) break
  }
  return notified
}

/**
 * Fan-out de proximidade de um spot recém-publicado: SPOT_NEARBY para quem está
 * perto E prefere a categoria. Se o criador é PREMIUM, alcança também quem está
 * perto mas NÃO prefere (descoberta), limitado pelo cap diário. Spot FRIENDS só
 * alcança follow mútuo do criador. Cancelado/encerrado não dispara.
 */
export async function runSpotPublishedFanout(
  spotId: string,
): Promise<{ notified: number }> {
  try {
    const spot = await findSpotForFanout(spotId)
    // Job atrasado (BullMQ é at-least-once): não notifica rolê cancelado nem já
    // encerrado — seria "rolê perto de você" de algo que não existe mais.
    if (!spot || spot.canceledAt || spot.endsAt <= new Date()) {
      return { notified: 0 }
    }

    const dedupeKey = notificationDedupeKey({ type: 'SPOT_NEARBY', spotId })

    let notified = await fanOutNearby(spot, dedupeKey, { spotId }, false)

    if (spot.creator.isPremium) {
      notified += await fanOutNearby(
        spot,
        dedupeKey,
        { spotId, discovery: true },
        true,
      )
    }

    return { notified }
  } catch (err) {
    logger.warn({ err, spotId }, 'fan-out de spot (nearby) falhou')
    return { notified: 0 }
  }
}

/**
 * Notifica o criador + membros atuais quando alguém entra no grupo do spot
 * (SPOT_JOIN), exceto quem entrou. Conjunto pequeno (membros), sem paginação.
 * Idempotente por (spot, quem entrou).
 */
export async function runSpotJoinedFanout(
  spotId: string,
  joinerId: string,
): Promise<{ notified: number }> {
  try {
    const spot = await findSpotForFanout(spotId)
    if (!spot || spot.canceledAt) return { notified: 0 }

    const participantIds = await findActiveParticipantUserIds(
      spot.conversationId,
    )
    const recipients = participantIds.filter((id) => id !== joinerId)
    if (recipients.length === 0) return { notified: 0 }

    const actor = await findActorSummary(joinerId)
    const dedupeKey = notificationDedupeKey({
      type: 'SPOT_JOIN',
      spotId,
      actorId: joinerId,
    })

    const existing = await findExistingUserIdsByDedupeKey(recipients, dedupeKey)
    const newUserIds = recipients.filter((id) => !existing.has(id))
    if (newUserIds.length === 0) return { notified: 0 }

    await createManyNotifications(
      newUserIds.map((userId) => ({
        userId,
        type: 'SPOT_JOIN' as const,
        actorId: joinerId,
        spotId,
        params: { spotTitle: spot.title },
        data: { spotId, actorId: joinerId },
        dedupeKey,
      })),
    )
    const created = await findNotificationsByDedupeKey(newUserIds, dedupeKey)
    await deliverNotifications(created, actor)
    return { notified: created.length }
  } catch (err) {
    logger.warn({ err, spotId, joinerId }, 'fan-out de spot (join) falhou')
    return { notified: 0 }
  }
}
