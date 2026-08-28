import { logger } from '../../lib/logger'
import { stripe } from '../../lib/stripe'
import type { StripeSubscriptionLike } from './billing.mapper'
import {
  findKnownStripeSubscriptionIds,
  findStaleActiveSubscriptions,
} from './billing.repository'
import {
  adoptOrphanSubscription,
  syncSubscriptionFromStripe,
} from './billing.service'

const reconcilerLog = logger.child({ component: 'billing-sync' })

// Teto de subscriptions re-sincronizadas por tick: protege o tick (e a cota
// da API do Stripe) de um backlog gigante; o restante fica pros próximos.
const SYNC_BATCH_SIZE = 50

// Só varremos o que ainda pode virar premium — `canceled`/`incomplete_expired`
// nunca produziriam uma linha que concede valor.
const ORPHAN_SCAN_STATUSES = ['trialing', 'active'] as const

// Página única por status: o normal é zero órfã por tick, e um teto baixo
// mantém o custo da varredura previsível.
const ORPHAN_SCAN_LIMIT = 100

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

/**
 * A outra metade da rede de segurança. O reconcileStaleSubscriptions parte da
 * linha local pra confirmar o estado no Stripe; ele não tem como cobrir um
 * `customer.subscription.created` perdido, porque aí não existe linha nenhuma
 * pra reconciliar. O usuário fica com assinatura viva no gateway (cartão
 * confirmado, trial correndo) e sem premium aqui — sem recuperação automática.
 *
 * Detecção: assinatura viva no Stripe (trialing/active) criada dentro do
 * lookback e desconhecida do banco. A janela existe porque varrer a conta
 * inteira a cada tick não escala; ela cobre com folga o retry do próprio
 * Stripe (~3 dias) e qualquer indisponibilidade plausível do endpoint.
 *
 * Idempotente: adotada, a assinatura passa a ser conhecida e sai da varredura.
 * Falha em uma não derruba o lote — as outras seguem e a que falhou volta no
 * próximo tick.
 */
export async function reconcileOrphanStripeSubscriptions(
  lookbackMs: number,
  now: Date = new Date(),
) {
  const createdSince = Math.floor((now.getTime() - lookbackMs) / 1000)
  let scanned = 0
  let adopted = 0
  let failed = 0

  for (const status of ORPHAN_SCAN_STATUSES) {
    let listed: StripeSubscriptionLike[]
    try {
      const page = await stripe.subscriptions.list({
        status,
        created: { gte: createdSince },
        limit: ORPHAN_SCAN_LIMIT,
        // O cartão do trial mora no Customer, não na subscription — expandir
        // aqui evita um retrieve por órfã encontrada.
        expand: ['data.customer'],
      })
      listed = page.data as unknown as StripeSubscriptionLike[]
    } catch (err) {
      failed++
      reconcilerLog.error({ err, status }, 'orphan scan failed')
      continue
    }

    scanned += listed.length
    const known = await findKnownStripeSubscriptionIds(
      listed.map((sub) => sub.id),
    )

    for (const sub of listed) {
      if (known.has(sub.id)) continue
      try {
        if ((await adoptOrphanSubscription(sub, now)) === 'adopted') adopted++
      } catch (err) {
        failed++
        reconcilerLog.error(
          { err, stripeSubscriptionId: sub.id },
          'subscription adoption failed',
        )
      }
    }
  }

  if (adopted > 0 || failed > 0) {
    reconcilerLog.warn(
      { scanned, adopted, failed },
      'orphan subscriptions adopted',
    )
  }
  return { scanned, adopted, failed }
}

let timer: NodeJS.Timeout | null = null
let isReconciling = false

export function startBillingSyncReconciler(
  intervalMs: number,
  graceMs: number,
  orphanLookbackMs: number,
) {
  reconcilerLog.info(
    { intervalMs, graceMs, orphanLookbackMs },
    'Starting billing sync reconciler',
  )
  if (timer) return
  timer = setInterval(() => {
    // Evita sobreposição de ticks na mesma instância.
    if (isReconciling) return
    isReconciling = true
    // As duas direções da rede de segurança no mesmo tick: confirmar o que já
    // conhecemos e descobrir o que nunca chegou. Sequenciais pra não dobrar a
    // pressão sobre a API do Stripe num mesmo instante.
    reconcileStaleSubscriptions(graceMs)
      .then(() => reconcileOrphanStripeSubscriptions(orphanLookbackMs))
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
