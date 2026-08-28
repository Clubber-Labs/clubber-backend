import { env } from '../../lib/env'
import { logger } from '../../lib/logger'
import { findEventForFanout } from '../events/events.repository'
import {
  createManyNotifications,
  findExistingUserIdsByDedupeKey,
  findNotificationsByDedupeKey,
  findUserIdsNotifiedOfEventSince,
} from './notification.repository'
import { deliverNotifications } from './notification-delivery'
import { findUsersToNotifyForPromotion } from './proximity.repository'

const promotionLog = logger.child({ component: 'promotion-fanout' })

// Sem endDate o evento é tratado como durando 4h — mesma convenção do feed.
const DEFAULT_DURATION_MS = 4 * 3600_000

/**
 * Chave por ONDA: a promoção alcança a mesma pessoa mais de uma vez ao longo da
 * janela, e `@@unique([userId, dedupeKey])` exige uma chave distinta por envio.
 * O prefixo `EVENT_NEARBY:promoted:` continua sendo o que identifica push de
 * promoção (teto de fadiga e relatórios varrem por ele).
 */
export function promotionWaveDedupeKey(eventId: string, wave: number): string {
  return `EVENT_NEARBY:promoted:${eventId}:${wave}`
}

/**
 * Onda 1 — o alcance que o anunciante pagou. Dispara quando a janela do
 * destaque abre e vai para TODOS os elegíveis no raio, sem filtro de
 * preferência e sem teto de fadiga: a garantia de entrega é o produto.
 *
 * Diferente do fan-out de criação, NÃO exclui quem já foi notificado do evento
 * — quem recebeu "evento novo perto de você" é justamente o público de maior
 * intenção, e barrá-lo esvaziava a promoção. A chave da onda é distinta da de
 * criação, então as duas linhas coexistem sem violar a unique.
 */
export async function runPromotionReachFanout(
  eventId: string,
  now = new Date(),
): Promise<{ notified: number }> {
  try {
    const event = await findEventForFanout(eventId)
    if (!event || !event.isPublic || event.canceledAt || !event.isFeatured) {
      return { notified: 0 }
    }
    const end =
      event.endDate ?? new Date(event.date.getTime() + DEFAULT_DURATION_MS)
    if (end.getTime() <= now.getTime()) return { notified: 0 }

    const dedupeKey = promotionWaveDedupeKey(eventId, 1)
    const batchSize = env.NOTIFY_FANOUT_BATCH_SIZE
    const gapCutoff = new Date(
      now.getTime() - env.PROMOTION_REACH_MIN_GAP_HOURS * 3600_000,
    )

    let cursorId: string | undefined
    let notified = 0

    while (true) {
      const userIds = await findUsersToNotifyForPromotion(
        {
          eventId,
          longitude: event.longitude,
          latitude: event.latitude,
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

      const existing = await findExistingUserIdsByDedupeKey(userIds, dedupeKey)
      // Promover logo depois de criar mandaria os dois pushes do mesmo evento
      // com segundos de diferença (e em ordem não garantida, já que os dois
      // jobs correm em paralelo). Quem soube do evento agora — pelo fan-out de
      // criação ou por convite — fica para as ondas de reforço.
      const justNotified = await findUserIdsNotifiedOfEventSince(
        userIds,
        eventId,
        gapCutoff,
      )
      const newUserIds = userIds.filter(
        (id) => !existing.has(id) && !justNotified.has(id),
      )

      if (newUserIds.length > 0) {
        await createManyNotifications(
          newUserIds.map((userId) => ({
            userId,
            type: 'EVENT_NEARBY' as const,
            eventId,
            params: { eventTitle: event.title, promoted: true },
            data: { eventId },
            dedupeKey,
          })),
        )

        // Busca pela CHAVE (não pelo evento): quem também tem a notificação de
        // criação teria a linha antiga reentregue, duplicando o push.
        const created = await findNotificationsByDedupeKey(
          newUserIds,
          dedupeKey,
        )
        await deliverNotifications(created)
        notified += created.length
      }

      if (userIds.length < batchSize) break
    }

    promotionLog.info({ eventId, notified }, 'alcance de promoção concluído')
    return { notified }
  } catch (err) {
    promotionLog.warn({ err, eventId }, 'alcance de promoção falhou')
    return { notified: 0 }
  }
}
