import { logger } from '../../lib/logger'
import { findStaleActiveSubscriptions } from './billing.repository'
import { syncSubscriptionFromStripe } from './billing.service'

const reconcilerLog = logger.child({ component: 'billing-sync' })

// Teto de subscriptions re-sincronizadas por tick: protege o tick (e a cota
// da API do Stripe) de um backlog gigante; o restante fica pros próximos.
const SYNC_BATCH_SIZE = 50

/**
 * Rede de segurança pra webhook perdido. O estado premium é dirigido por
 * webhooks, mas entrega não é garantida (endpoint fora do ar, 429, evento
 * descartado): se um customer.subscription.deleted se perde, a subscription
 * fica "ativa" local pra sempre e o usuário mantém premium sem pagar.
 *
 * Detecção: subscription com status ativo e currentPeriodEnd além da
 * tolerância (renovação teria avançado o período; cancelamento teria mudado o
 * status). Correção: re-sync da verdade do Stripe via
 * syncSubscriptionFromStripe — nunca rebaixa por conta própria. Idempotente:
 * sincronizada com período futuro (ou status terminal) sai do WHERE; erro em
 * uma não derruba o lote (retry natural no próximo tick).
 */
export async function reconcileStaleSubscriptions(
  graceMs: number,
  now: Date = new Date(),
) {
  const cutoff = new Date(now.getTime() - graceMs)
  const due = await findStaleActiveSubscriptions(cutoff, SYNC_BATCH_SIZE)
  let synced = 0
  let failed = 0
  for (const sub of due) {
    try {
      await syncSubscriptionFromStripe(sub)
      synced++
    } catch (err) {
      failed++
      reconcilerLog.error(
        { err, stripeSubscriptionId: sub.stripeSubscriptionId },
        'subscription sync failed',
      )
    }
  }
  if (due.length > 0) {
    reconcilerLog.info(
      { due: due.length, synced, failed },
      'stale subscriptions synced',
    )
  }
  return { due: due.length, synced, failed }
}

let timer: NodeJS.Timeout | null = null
let isReconciling = false

export function startBillingSyncReconciler(
  intervalMs: number,
  graceMs: number,
) {
  reconcilerLog.info(
    { intervalMs, graceMs },
    'Starting billing sync reconciler',
  )
  if (timer) return
  timer = setInterval(() => {
    // Evita sobreposição de ticks na mesma instância.
    if (isReconciling) return
    isReconciling = true
    reconcileStaleSubscriptions(graceMs)
      .catch((err) => {
        reconcilerLog.error({ err }, 'billing sync failed')
      })
      .finally(() => {
        isReconciling = false
      })
  }, intervalMs)
  timer.unref?.()
}

export function stopBillingSyncReconciler() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
