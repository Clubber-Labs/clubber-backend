import { logger } from '../../lib/logger'
import { prisma } from '../../lib/prisma'
import { enqueuePromotionStarted } from '../notifications/notification-queue'

export async function reconcileFeaturedEvents() {
  const deactivated = await prisma.$executeRaw`
    UPDATE "events"
    SET "isFeatured" = false
    WHERE "isFeatured" = true
      AND NOT EXISTS (
        SELECT 1 FROM "featured_events" fe
        WHERE fe."eventId" = "events"."id"
          AND fe."canceledAt" IS NULL
          AND now() BETWEEN fe."startsAt" AND fe."endsAt"
      )
  `

  // RETURNING para enfileirar o alcance pago dos destaques AGENDADOS, cuja
  // janela abre aqui (o de janela imediata já é enfileirado na criação).
  const activated = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "events"
    SET "isFeatured" = true
    WHERE "isFeatured" = false
      AND EXISTS (
        SELECT 1 FROM "featured_events" fe
        WHERE fe."eventId" = "events"."id"
          AND fe."canceledAt" IS NULL
          AND now() BETWEEN fe."startsAt" AND fe."endsAt"
      )
    RETURNING "id"
  `

  for (const event of activated) {
    await enqueuePromotionStarted(event.id)
  }

  return { deactivated, activated: activated.length }
}

let timer: NodeJS.Timeout | null = null
let isReconciling = false

const reconcilerLog = logger.child({ component: 'featured-events-reconciler' })

export function startFeaturedEventsReconciler(intervalMs: number) {
  reconcilerLog.info({ intervalMs }, 'Starting featured events reconciler')
  if (timer) return
  timer = setInterval(() => {
    // Evita sobreposição de ticks na mesma instância: se um reconcile
    // ainda está rodando (interval menor que tempo de execução), pula.
    if (isReconciling) return
    isReconciling = true
    reconcileFeaturedEvents()
      .catch((err) => {
        reconcilerLog.error({ err }, 'featured-events reconciliation failed')
      })
      .finally(() => {
        isReconciling = false
      })
  }, intervalMs)
  timer.unref?.()
}

export function stopFeaturedEventsReconciler() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
