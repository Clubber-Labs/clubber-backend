import { logger } from '../../lib/logger'
import { deleteNotificationsOlderThan } from './notification.repository'

const reconcilerLog = logger.child({ component: 'notification-retention' })

/**
 * Expurga notificações in-app além do prazo de retenção (minimização LGPD).
 * Idempotente: uma notificação removida sai do WHERE. Espelha o reconciler de
 * password-reset.
 */
export async function reconcileNotificationRetention(
  retentionDays: number,
  now: Date = new Date(),
) {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000)
  const deleted = await deleteNotificationsOlderThan(cutoff)
  if (deleted > 0) reconcilerLog.info({ deleted }, 'notifications purged')
  return { deleted }
}

let timer: NodeJS.Timeout | null = null
let isReconciling = false

export function startNotificationRetentionReconciler(
  intervalMs: number,
  retentionDays: number,
) {
  reconcilerLog.info(
    { intervalMs, retentionDays },
    'Starting notification retention reconciler',
  )
  if (timer) return
  timer = setInterval(() => {
    // Evita sobreposição de ticks na mesma instância.
    if (isReconciling) return
    isReconciling = true
    reconcileNotificationRetention(retentionDays)
      .catch((err) => {
        reconcilerLog.error({ err }, 'notification retention failed')
      })
      .finally(() => {
        isReconciling = false
      })
  }, intervalMs)
  timer.unref?.()
}

export function stopNotificationRetentionReconciler() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
