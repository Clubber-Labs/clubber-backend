import { logger } from '../../lib/logger'
import { reconcilePushReceipts } from './notification-push.service'

const reconcilerLog = logger.child({ component: 'push-receipts' })
const RECEIPTS_BATCH_LIMIT = 1000

/**
 * Reconcilia os receipts dos pushes pendentes maduros (criados há mais que
 * delayMs). Roda como reconciler periódico, no padrão dos demais.
 */
export async function runPushReceiptsReconcile(delayMs: number) {
  const result = await reconcilePushReceipts({
    delayMs,
    limit: RECEIPTS_BATCH_LIMIT,
  })
  if (result.checked > 0) {
    reconcilerLog.info(result, 'push receipts reconciled')
  }
  return result
}

let timer: NodeJS.Timeout | null = null
let isReconciling = false

export function startPushReceiptsReconciler(
  intervalMs: number,
  delayMs: number,
) {
  reconcilerLog.info(
    { intervalMs, delayMs },
    'Starting push receipts reconciler',
  )
  if (timer) return
  timer = setInterval(() => {
    if (isReconciling) return
    isReconciling = true
    runPushReceiptsReconcile(delayMs)
      .catch((err) => {
        reconcilerLog.error({ err }, 'push receipts reconcile failed')
      })
      .finally(() => {
        isReconciling = false
      })
  }, intervalMs)
  timer.unref?.()
}

export function stopPushReceiptsReconciler() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
