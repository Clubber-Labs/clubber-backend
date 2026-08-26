import { logger } from '../logger'
import { chatKekRewrapPending, chatKekRewrapTotal } from '../metrics'
import { getKeyProvider } from './index'
import { type RewrapSource, rewrapCandidate } from './rewrap'

const reconcilerLog = logger.child({ component: 'kek-rewrap-reconciler' })

const BATCH_SIZE = 200
// Teto por tick para uma base grande não segurar o processo indefinidamente. O
// que sobrar volta no próximo tick — o predicado `kekVersion < ativa` é o cursor.
const MAX_ROWS_PER_TICK = 5000

type SourceResult = {
  source: string
  rewrapped: number
  skipped: number
  failed: number
  pending: number
}

async function drainSource(
  source: RewrapSource,
  activeVersion: number,
): Promise<Omit<SourceResult, 'pending'>> {
  const provider = getKeyProvider()
  let rewrapped = 0
  let skipped = 0
  let failed = 0
  let processed = 0

  while (processed < MAX_ROWS_PER_TICK) {
    const batch = await source.findPending(activeVersion, BATCH_SIZE)
    if (batch.length === 0) break
    const rewrappedBefore = rewrapped

    for (const candidate of batch) {
      processed++
      try {
        const outcome = await rewrapCandidate(candidate, source, provider)
        if (outcome === 'rewrapped') rewrapped++
        else skipped++
      } catch (err) {
        failed++
        // KEK antiga fora do ambiente cai aqui. Logar a versão é o que permite
        // reconhecer o caso sem abrir o banco.
        reconcilerLog.error(
          {
            err,
            source: source.name,
            id: candidate.id,
            kekVersion: candidate.kekVersion,
          },
          'rewrap falhou',
        )
      }
    }

    // Lote incompleto = fonte drenada. Lote inteiro sem NENHUM rewrap também
    // encerra: só o rewrap tira a linha do predicado, então sem progresso a
    // próxima consulta devolveria exatamente as mesmas linhas.
    if (batch.length < BATCH_SIZE || rewrapped === rewrappedBefore) break
  }

  if (processed >= MAX_ROWS_PER_TICK) {
    reconcilerLog.info(
      { source: source.name, processed },
      'teto do tick atingido — o restante segue no próximo',
    )
  }

  chatKekRewrapTotal.inc(
    { source: source.name, result: 'rewrapped' },
    rewrapped,
  )
  chatKekRewrapTotal.inc({ source: source.name, result: 'skipped' }, skipped)
  chatKekRewrapTotal.inc({ source: source.name, result: 'failed' }, failed)

  return { source: source.name, rewrapped, skipped, failed }
}

/**
 * Reembrulha na KEK ativa o que ainda está em versão antiga. Idempotente e
 * retomável: o predicado das fontes é o próprio cursor, então um tick
 * interrompido não perde lugar.
 *
 * Sem lock entre instâncias, de propósito — o compare-and-set do `persist` já
 * torna a corrida inofensiva, e é o mesmo desenho local-guard dos outros
 * reconcilers do projeto.
 */
export async function reconcileKekRewrap(
  sources: RewrapSource[],
): Promise<SourceResult[]> {
  const activeVersion = getKeyProvider().activeVersion()
  const results: SourceResult[] = []
  const pendingByLabel: {
    source: string
    kekVersion: number
    pending: number
  }[] = []

  for (const source of sources) {
    try {
      const drained = await drainSource(source, activeVersion)
      const pending = await source.countPending(activeVersion)
      for (const row of pending) {
        pendingByLabel.push({ source: source.name, ...row })
      }
      const total = pending.reduce((sum, row) => sum + row.pending, 0)
      results.push({ ...drained, pending: total })
      reconcilerLog.info({ ...drained, pending: total }, 'rewrap concluído')
    } catch (err) {
      reconcilerLog.error(
        { err, source: source.name },
        'fonte de rewrap falhou',
      )
    }
  }

  // Reset antes de repopular: `countPending` não devolve linha para versão já
  // drenada, então sem isto a KEK antiga ficaria pendurada no último valor para
  // sempre — justamente o sinal que autoriza removê-la do ambiente.
  chatKekRewrapPending.reset()
  for (const row of pendingByLabel) {
    chatKekRewrapPending.set(
      { source: row.source, kek_version: String(row.kekVersion) },
      row.pending,
    )
  }

  return results
}

let timer: NodeJS.Timeout | null = null
let isReconciling = false

export function startKekRewrapReconciler(
  intervalMs: number,
  sources: RewrapSource[],
) {
  reconcilerLog.info({ intervalMs }, 'Starting KEK rewrap reconciler')
  if (timer) return
  timer = setInterval(() => {
    if (isReconciling) return
    isReconciling = true
    reconcileKekRewrap(sources)
      .catch((err) => {
        reconcilerLog.error({ err }, 'KEK rewrap reconciliation failed')
      })
      .finally(() => {
        isReconciling = false
      })
  }, intervalMs)
  timer.unref?.()
}

export function stopKekRewrapReconciler() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
