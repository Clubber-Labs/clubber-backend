import { reconcilerLockTtl, runWithLock } from '../../lib/leader-lock'
import { logger } from '../../lib/logger'
import { findAccountsDueForUnsuspension } from './users.repository'
import { unsuspendUser } from './users.service'

const reconcilerLog = logger.child({ component: 'suspension-reconciler' })

/**
 * Expira suspensões temporárias vencidas (SUSPENDED com suspendedUntil <= now)
 * → ACTIVE. Idempotente: cada conta reativada sai do WHERE; erro numa conta não
 * derruba o lote. O login dentro da janela auto-cura antes daqui
 * (clearExpiredSuspensionOnLogin). Banimento é permanente e nunca casa o WHERE.
 */
export async function reconcileSuspensions(now: Date = new Date()) {
  const due = await findAccountsDueForUnsuspension(now)
  let unsuspended = 0
  for (const { id } of due) {
    try {
      await unsuspendUser(id)
      unsuspended++
    } catch (err) {
      reconcilerLog.error({ err, userId: id }, 'suspension expiry failed')
    }
  }
  return { due: due.length, unsuspended }
}

let timer: NodeJS.Timeout | null = null
let isReconciling = false

export function startSuspensionReconciler(intervalMs: number) {
  reconcilerLog.info({ intervalMs }, 'Starting suspension reconciler')
  if (timer) return
  timer = setInterval(() => {
    if (isReconciling) return
    isReconciling = true
    runWithLock(
      'suspension',
      reconcilerLockTtl(intervalMs),
      reconcileSuspensions,
    )
      .catch((err) => {
        reconcilerLog.error({ err }, 'suspension reconciliation failed')
      })
      .finally(() => {
        isReconciling = false
      })
  }, intervalMs)
  timer.unref?.()
}

export function stopSuspensionReconciler() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
