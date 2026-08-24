import { env } from '../../lib/env'
import { logger } from '../../lib/logger'
import { deleteChatMedia } from '../../lib/uploads'
import {
  findExpiredEvidences,
  purgeEvidence,
} from './report-evidence.repository'

const reconcilerLog = logger.child({ component: 'report-evidence-reconciler' })

const BATCH_SIZE = 100

/**
 * Expurga a prova vencida: a mídia retida no storage e o payload cifrado. É o
 * que fecha o ciclo da LGPD — sem prazo, o snapshot vira arquivo eterno de
 * conversa privada.
 *
 * Idempotente e retomável: `purgedAt` tira a linha do WHERE, então o próprio
 * predicado é o cursor e erro numa evidência não derruba o lote. A mídia é
 * apagada ANTES da linha ser zerada; se o processo morrer no meio, a próxima
 * passada reencontra a linha e tenta de novo (deleteChatMedia é best-effort com
 * key inexistente).
 */
export async function reconcileReportEvidenceRetention(now: Date = new Date()) {
  const cutoff = new Date(
    now.getTime() - env.CHAT_EVIDENCE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  )
  const due = await findExpiredEvidences(cutoff, BATCH_SIZE)
  let purged = 0
  for (const evidence of due) {
    try {
      await Promise.all(
        evidence.retainedMediaKeys.map((key) =>
          deleteChatMedia(key, reconcilerLog),
        ),
      )
      await purgeEvidence(evidence.id)
      purged++
    } catch (err) {
      reconcilerLog.error(
        { err, evidenceId: evidence.id },
        'evidence purge failed',
      )
    }
  }
  return { due: due.length, purged }
}

let timer: NodeJS.Timeout | null = null
let isReconciling = false

export function startReportEvidenceReconciler(intervalMs: number) {
  reconcilerLog.info({ intervalMs }, 'Starting report evidence reconciler')
  if (timer) return
  timer = setInterval(() => {
    if (isReconciling) return
    isReconciling = true
    reconcileReportEvidenceRetention()
      .catch((err) => {
        reconcilerLog.error({ err }, 'evidence retention reconciliation failed')
      })
      .finally(() => {
        isReconciling = false
      })
  }, intervalMs)
  timer.unref?.()
}

export function stopReportEvidenceReconciler() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
