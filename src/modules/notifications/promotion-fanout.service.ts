import { env } from '../../lib/env'
import { resolveEndDate } from '../../lib/event-lifecycle'
import { logger } from '../../lib/logger'
import { findEventForFanout } from '../events/events.repository'
import { findActiveFeature } from '../featured-events/featured-events.repository'
import {
  createManyNotifications,
  findExistingUserIdsByDedupeKey,
  findNotificationsByDedupeKey,
  findUserIdsNotifiedOfEventSince,
} from './notification.repository'
import { deliverNotifications } from './notification-delivery'
import { findUsersToNotifyForPromotion } from './proximity.repository'

const promotionLog = logger.child({ component: 'promotion-fanout' })

/**
 * Chave por ONDA de UMA COMPRA: a promoção alcança a mesma pessoa mais de uma
 * vez ao longo da janela, e `@@unique([userId, dedupeKey])` exige chave
 * distinta por envio. O escopo é o `FeaturedEvent`, não o evento — o mesmo
 * evento pode ser promovido de novo em janelas não sobrepostas, e escopar por
 * evento faria a segunda compra encontrar todo mundo já notificado e não
 * entregar nada. O prefixo `EVENT_NEARBY:promoted:` continua identificando
 * push de promoção (teto de fadiga e relatórios varrem por ele).
 */
export function promotionWaveDedupeKey(
  featureId: string,
  wave: number,
): string {
  return `EVENT_NEARBY:promoted:${featureId}:${wave}`
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
 *
 * NÃO engole erro, ao contrário dos fan-outs gratuitos: a entrega foi paga, e
 * o job `promotion.started` tem retentativa. Perder o alcance em silêncio é
 * pior do que a falha aparecer na fila.
 */
export async function runPromotionReachFanout(
  eventId: string,
  now = new Date(),
): Promise<{ notified: number }> {
  const event = await findEventForFanout(eventId)
  if (!event || !event.isPublic || event.canceledAt) return { notified: 0 }
  if (resolveEndDate(event.date, event.endDate) <= now) {
    return { notified: 0 }
  }

  // A compra vigente é o gate E o escopo da chave — ler `featured_events`
  // direto evita depender do espelho `isFeatured`, atrasado até um tick.
  const feature = await findActiveFeature(eventId, now)
  if (!feature) return { notified: 0 }

  const dedupeKey = promotionWaveDedupeKey(feature.id, 1)
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
    // com segundos de diferença (e em ordem não garantida, já que os dois jobs
    // correm em paralelo). Quem soube do evento agora — pelo fan-out de criação
    // ou por convite — fica para as ondas de reforço.
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
      const created = await findNotificationsByDedupeKey(newUserIds, dedupeKey)
      await deliverNotifications(created)
      notified += created.length
    }

    if (userIds.length < batchSize) break
  }

  promotionLog.info(
    { eventId, featureId: feature.id, notified },
    'alcance de promoção concluído',
  )
  return { notified }
}
