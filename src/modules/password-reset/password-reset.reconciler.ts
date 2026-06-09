import { logger } from '../../lib/logger'
import { deleteExpiredAndUsedCodes } from './password-reset.repository'

const reconcilerLog = logger.child({ component: 'password-reset-cleanup' })

/**
 * Expurga códigos de recuperação já usados ou expirados (minimização/retenção
 * LGPD). Idempotente: um código removido sai do WHERE. Os códigos vivos (não
 * usados e não expirados) são preservados.
 */
export async function reconcilePasswordResetCodes(now: Date = new Date()) {
  const { count } = await deleteExpiredAndUsedCodes(now)
  if (count > 0) reconcilerLog.info({ deleted: count }, 'reset codes purged')
  return { deleted: count }
}

let timer: NodeJS.Timeout | null = null
let isReconciling = false

export function startPasswordResetCleanupReconciler(intervalMs: number) {
  reconcilerLog.info(
    { intervalMs },
    'Starting password reset cleanup reconciler',
  )
  if (timer) return
  timer = setInterval(() => {
    // Evita sobreposição de ticks na mesma instância.
    if (isReconciling) return
    isReconciling = true
    reconcilePasswordResetCodes()
      .catch((err) => {
        reconcilerLog.error({ err }, 'password reset cleanup failed')
      })
      .finally(() => {
        isReconciling = false
      })
  }, intervalMs)
  timer.unref?.()
}

export function stopPasswordResetCleanupReconciler() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
