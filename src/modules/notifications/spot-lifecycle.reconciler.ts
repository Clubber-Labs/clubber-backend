import { env } from '../../lib/env'
import { logger } from '../../lib/logger'
import { realtime } from '../../lib/realtime'
import {
  deleteCleanableSpot,
  findCleanableSpots,
  findSpotsNeedingRenewalReminder,
  markSpotRenewalNotified,
} from '../spots/spots.repository'
import { createNotificationIfNew } from './notification.repository'
import { sendPushBatch } from './notification-push.service'
import {
  buildPushData,
  notificationDedupeKey,
  shapeNotification,
} from './notification-shape'

const reconcilerLog = logger.child({ component: 'spot-lifecycle' })

/**
 * Lembrete de renovação: para cada spot ativo vencendo dentro de `leadMs` e
 * ainda não lembrado, notifica o CRIADOR (SPOT_RENEWAL). Idempotente em duas
 * camadas: CAS no renewalNotifiedAt (markSpotRenewalNotified) + dedupeKey por
 * JANELA (inclui endsAt) — assim um spot renovado, cujo lembrete foi re-armado
 * (renewalNotifiedAt zerado no renew), gera uma chave nova e lembra de novo.
 */
export async function runSpotRenewalReminders(now: Date, leadMs: number) {
  const batch = env.NOTIFY_FANOUT_BATCH_SIZE
  const spots = await findSpotsNeedingRenewalReminder(now, leadMs, batch)

  // createNotificationIfNew devolve a notificação ou null (dedupe); aqui só
  // empilhamos as não-nulas, então o array é do tipo já desembrulhado.
  type CreatedNotification = NonNullable<
    Awaited<ReturnType<typeof createNotificationIfNew>>
  >
  const created: CreatedNotification[] = []
  for (const spot of spots) {
    // CAS: só segue se ESTE tick conseguiu marcar (anti-corrida entre ticks).
    if ((await markSpotRenewalNotified(spot.id, now)) === 0) continue

    const dedupeKey = `${notificationDedupeKey({
      type: 'SPOT_RENEWAL',
      spotId: spot.id,
    })}:w${spot.endsAt.getTime()}`
    const notification = await createNotificationIfNew({
      userId: spot.creatorId,
      type: 'SPOT_RENEWAL',
      spotId: spot.id,
      title: 'Seu rolê está acabando',
      body: `"${spot.title}" expira em breve — renove por mais 24h`,
      data: { spotId: spot.id },
      dedupeKey,
    })
    if (notification) created.push(notification)
  }

  // Entrega best-effort (foreground + push).
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
      content: { title: n.title, body: n.body, data: buildPushData(n) },
    })),
  )

  if (created.length > 0) {
    reconcilerLog.info({ reminded: created.length }, 'spot renewal reminders')
  }
  return { reminded: created.length }
}

/**
 * Limpeza no vencimento: spots cancelados ou encerrados saem do banco. Se o grupo
 * só tem o criador (≤ 1 membro ativo) → apaga o spot E a conversa; se tem outros
 * membros → apaga só o spot e MANTÉM a conversa (vira grupo normal). Ordem segura
 * pela FK spot→conversation RESTRICT (spot antes da conversa) e pelo guard de
 * elegibilidade no delete (anti-corrida com renew). Idempotente.
 */
export async function runSpotCleanup(now: Date) {
  const batch = env.NOTIFY_FANOUT_BATCH_SIZE
  const spots = await findCleanableSpots(now, batch)

  let deleted = 0
  let graduated = 0
  for (const spot of spots) {
    // Spot + conversa caem juntos numa transação (ou nada cai se renovou no
    // meio → 'skipped'). 'deleted' = grupo só com o criador apagado junto;
    // 'graduated' = grupo com outros membros sobrevive como conversa normal.
    const outcome = await deleteCleanableSpot(spot.id, spot.conversationId, now)
    if (outcome === 'deleted') deleted++
    else if (outcome === 'graduated') graduated++
  }

  if (deleted > 0 || graduated > 0) {
    reconcilerLog.info({ deleted, graduated }, 'spot cleanup')
  }
  return { deleted, graduated }
}

/** Roda lembrete + limpeza num tick. Testável direto (sem o timer). */
export async function reconcileSpotLifecycle(
  leadMs: number,
  now: Date = new Date(),
) {
  const reminders = await runSpotRenewalReminders(now, leadMs)
  const cleanup = await runSpotCleanup(now)
  return { ...reminders, ...cleanup }
}

let timer: NodeJS.Timeout | null = null
let isReconciling = false

export function startSpotLifecycleReconciler(
  intervalMs: number,
  leadMs: number,
) {
  reconcilerLog.info(
    { intervalMs, leadMs },
    'Starting spot lifecycle reconciler',
  )
  if (timer) return
  timer = setInterval(() => {
    if (isReconciling) return
    isReconciling = true
    reconcileSpotLifecycle(leadMs)
      .catch((err) => reconcilerLog.error({ err }, 'spot lifecycle failed'))
      .finally(() => {
        isReconciling = false
      })
  }, intervalMs)
  timer.unref?.()
}

export function stopSpotLifecycleReconciler() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
