import { logger } from '../../lib/logger'
import { deleteWebhookEventsOlderThan } from './billing.repository'

const reconcilerLog = logger.child({ component: 'billing-retention' })

/**
 * Expurga webhook_events além do prazo de retenção (minimização LGPD): o
 * payload carrega o evento Stripe inteiro (e-mail, nome, dados de cobrança).
 * A idempotência do webhook só precisa de janela recente — o Stripe reenvia
 * eventos por no máximo alguns dias. Idempotente: linha removida sai do WHERE.
 * Espelha o reconciler de notification-retention.
 */
export async function reconcileBillingWebhookRetention(
  retentionDays: number,
  now: Date = new Date(),
) {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000)
  const deleted = await deleteWebhookEventsOlderThan(cutoff)
  if (deleted > 0) reconcilerLog.info({ deleted }, 'webhook events purged')
  return { deleted }
}

let timer: NodeJS.Timeout | null = null
let isReconciling = false

export function startBillingRetentionReconciler(
  intervalMs: number,
  retentionDays: number,
) {
  reconcilerLog.info(
    { intervalMs, retentionDays },
    'Starting billing retention reconciler',
  )
  if (timer) return
  timer = setInterval(() => {
    // Evita sobreposição de ticks na mesma instância.
    if (isReconciling) return
    isReconciling = true
    reconcileBillingWebhookRetention(retentionDays)
      .catch((err) => {
        reconcilerLog.error({ err }, 'billing retention failed')
      })
      .finally(() => {
        isReconciling = false
      })
  }, intervalMs)
  timer.unref?.()
}

export function stopBillingRetentionReconciler() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
