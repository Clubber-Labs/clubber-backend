import { logger } from '../../lib/logger'
import { findAccountsDueForAnonymization } from './users.repository'
import { anonymizeAccount } from './users.service'

const reconcilerLog = logger.child({ component: 'account-deletion-reconciler' })

/**
 * Anonimiza contas PENDING_DELETION cuja carência venceu. Idempotente: cada
 * conta processada vira ANONYMIZED e sai do WHERE; erro em uma conta não derruba
 * o lote. Login dentro da janela reativa antes daqui (guard na transação).
 */
export async function reconcileAccountDeletions(now: Date = new Date()) {
  const due = await findAccountsDueForAnonymization(now)
  let anonymized = 0
  for (const { id } of due) {
    try {
      const ok = await anonymizeAccount(id, reconcilerLog, now)
      if (ok) anonymized++
    } catch (err) {
      reconcilerLog.error({ err, userId: id }, 'account anonymization failed')
    }
  }
  return { due: due.length, anonymized }
}

let timer: NodeJS.Timeout | null = null
let isReconciling = false

export function startAccountDeletionReconciler(intervalMs: number) {
  reconcilerLog.info({ intervalMs }, 'Starting account deletion reconciler')
  if (timer) return
  timer = setInterval(() => {
    // Evita sobreposição de ticks na mesma instância.
    if (isReconciling) return
    isReconciling = true
    reconcileAccountDeletions()
      .catch((err) => {
        reconcilerLog.error({ err }, 'account deletion reconciliation failed')
      })
      .finally(() => {
        isReconciling = false
      })
  }, intervalMs)
  timer.unref?.()
}

export function stopAccountDeletionReconciler() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
