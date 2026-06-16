import { env } from '../../lib/env'
import { logger } from '../../lib/logger'
import { realtime } from '../../lib/realtime'
import { findEventForFanout } from '../events/events.repository'
import {
  createManyNotifications,
  findExistingNearbyUserIds,
  findNotificationsForEvent,
} from './notification.repository'
import { sendPushBatch } from './notification-push.service'
import {
  buildPushData,
  notificationDedupeKey,
  shapeNotification,
} from './notification-shape'
import { findUsersToNotifyNearEvent } from './proximity.repository'

/**
 * Fan-out de proximidade de um evento recém-criado: pagina a query invertida e,
 * por lote, cria a notificação EVENT_NEARBY (idempotente), entrega em foreground
 * e envia push. EVENT_NEARBY = perto E categoria preferida (já filtrado no SQL).
 *
 * Idempotente: só processa quem AINDA não tem EVENT_NEARBY deste evento — um
 * retry do job (BullMQ é at-least-once) não duplica notificação nem re-empurra.
 * Best-effort: nunca lança (o worker registra a falha). Eventos privados ou
 * cancelados não disparam.
 */
export async function runEventCreatedFanout(
  eventId: string,
): Promise<{ notified: number }> {
  try {
    const event = await findEventForFanout(eventId)
    if (!event || !event.isPublic || event.canceledAt) return { notified: 0 }

    const content = {
      title: 'Tem evento perto de você',
      body: event.title,
      data: { eventId },
    }
    const dedupeKey = notificationDedupeKey({ type: 'EVENT_NEARBY', eventId })
    const batchSize = env.NOTIFY_FANOUT_BATCH_SIZE

    let cursorId: string | undefined
    let notified = 0

    while (true) {
      const userIds = await findUsersToNotifyNearEvent(
        {
          longitude: event.longitude,
          latitude: event.latitude,
          categories: event.categories,
          subcategories: event.subcategories,
          authorId: event.authorId,
        },
        {
          maxRadiusKm: env.NOTIFY_MAX_RADIUS_KM,
          ttlDays: env.NOTIFY_LOCATION_TTL_DAYS,
          limit: batchSize,
          cursorId,
        },
      )
      if (userIds.length === 0) break
      cursorId = userIds[userIds.length - 1]

      // Só quem ainda não tem a notificação deste evento (idempotência).
      const existing = await findExistingNearbyUserIds(userIds, eventId)
      const newUserIds = userIds.filter((id) => !existing.has(id))

      if (newUserIds.length > 0) {
        await createManyNotifications(
          newUserIds.map((userId) => ({
            userId,
            type: 'EVENT_NEARBY' as const,
            eventId,
            title: content.title,
            body: content.body,
            data: content.data,
            dedupeKey,
          })),
        )

        // Foreground (best-effort) das que foram criadas — em paralelo: cada
        // publish é um roundtrip Redis independente e nunca lança (catch
        // interno); sequencial somaria ~1s por lote de 500.
        const created = await findNotificationsForEvent(
          newUserIds,
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

        // Push (a query invertida já garantiu consentimento). O data leva o
        // notificationId de CADA destinatário (deep-link + mark-as-read no
        // tap), num único envio chunkado.
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
        // `created` (linhas que de fato existem), não `newUserIds`: se o
        // createMany pulou alguém numa corrida, o contador não infla.
        notified += created.length
      }

      if (userIds.length < batchSize) break
    }

    return { notified }
  } catch (err) {
    logger.warn({ err, eventId }, 'fan-out de proximidade falhou')
    return { notified: 0 }
  }
}
