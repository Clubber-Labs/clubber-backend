import { logger } from '../../lib/logger'
import { clearStaleUserLocations } from '../users/users.repository'

const reconcilerLog = logger.child({ component: 'location-retention' })

/**
 * Expurga localizações de usuários sem atualização há mais que o TTL
 * (minimização LGPD + frescor). Idempotente: uma localização zerada sai do
 * WHERE. Espelha o reconciler de password-reset/notification-retention.
 */
export async function reconcileLocationRetention(
  ttlDays: number,
  now: Date = new Date(),
) {
  const cutoff = new Date(now.getTime() - ttlDays * 24 * 60 * 60 * 1000)
  const cleared = await clearStaleUserLocations(cutoff)
  if (cleared > 0) reconcilerLog.info({ cleared }, 'stale locations purged')
  return { cleared }
}

let timer: NodeJS.Timeout | null = null
let isReconciling = false

export function startLocationRetentionReconciler(
  intervalMs: number,
  ttlDays: number,
) {
  reconcilerLog.info(
    { intervalMs, ttlDays },
    'Starting location retention reconciler',
  )
  if (timer) return
  timer = setInterval(() => {
    if (isReconciling) return
    isReconciling = true
    reconcileLocationRetention(ttlDays)
      .catch((err) => {
        reconcilerLog.error({ err }, 'location retention failed')
      })
      .finally(() => {
        isReconciling = false
      })
  }, intervalMs)
  timer.unref?.()
}

export function stopLocationRetentionReconciler() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
