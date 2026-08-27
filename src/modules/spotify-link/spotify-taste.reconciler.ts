import { AppError } from '../../lib/errors/app-error'
import { logger } from '../../lib/logger'
import { spotifySyncTotal } from '../../lib/metrics'
import { findLinksDueForSync } from './spotify-link.repository'
import { syncTasteForLink } from './spotify-link.service'

const reconcilerLog = logger.child({ component: 'spotify-taste-sync' })

// Teto de vínculos sincronizados por tick: protege o tick e a cota da API do
// Spotify de um backlog grande; o restante fica pros próximos.
const SYNC_BATCH_SIZE = 50

/**
 * Mantém o gosto musical atualizado sem o app aberto. O tick é curto (1h), mas
 * cada vínculo só entra na fila quando o sync vence (24h): o trabalho se
 * distribui pelo dia em vez de estourar de uma vez.
 *
 * Idempotente: sincronizado avança o lastSyncedAt e sai do WHERE, revogado sai
 * do WHERE, e erro em um vínculo não derruba o lote — o próximo tick é o retry
 * natural. A exceção é o 429: aí a cota já acabou, e insistir com os outros do
 * lote só queimaria mais requisição à toa.
 *
 * Assume instância única, como os demais reconcilers do projeto: sem lock
 * distribuído, N réplicas fariam N syncs (idempotentes, porém desperdiçados).
 */
export async function reconcileSpotifyTaste(
  maxAgeMs: number,
  now: Date = new Date(),
) {
  const cutoff = new Date(now.getTime() - maxAgeMs)
  const due = await findLinksDueForSync(cutoff, SYNC_BATCH_SIZE)
  let synced = 0
  let revoked = 0
  let failed = 0

  for (const link of due) {
    try {
      const result = await syncTasteForLink(link, now)
      if (result.outcome === 'revoked') revoked++
      else synced++
    } catch (err) {
      failed++
      spotifySyncTotal.inc({ outcome: 'failed' })
      reconcilerLog.error(
        { err, userId: link.userId },
        'spotify taste sync failed',
      )
      if (err instanceof AppError && err.code === 'SPOTIFY_RATE_LIMITED') {
        reconcilerLog.warn(
          { remaining: due.length - synced - revoked - failed },
          'spotify rate limit atingido, lote abortado',
        )
        break
      }
    }
  }

  if (due.length > 0) {
    reconcilerLog.info(
      { due: due.length, synced, revoked, failed },
      'spotify taste synced',
    )
  }
  return { due: due.length, synced, revoked, failed }
}

let timer: NodeJS.Timeout | null = null
let isReconciling = false

export function startSpotifyTasteReconciler(
  intervalMs: number,
  maxAgeMs: number,
) {
  reconcilerLog.info(
    { intervalMs, maxAgeMs },
    'Starting spotify taste reconciler',
  )
  if (timer) return
  timer = setInterval(() => {
    // Evita sobreposição de ticks na mesma instância.
    if (isReconciling) return
    isReconciling = true
    reconcileSpotifyTaste(maxAgeMs)
      .catch((err) => {
        reconcilerLog.error({ err }, 'spotify taste sync failed')
      })
      .finally(() => {
        isReconciling = false
      })
  }, intervalMs)
  timer.unref?.()
}

export function stopSpotifyTasteReconciler() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
