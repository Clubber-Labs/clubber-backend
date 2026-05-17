import { prisma } from '../../lib/prisma'

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

  const activated = await prisma.$executeRaw`
    UPDATE "events"
    SET "isFeatured" = true
    WHERE "isFeatured" = false
      AND EXISTS (
        SELECT 1 FROM "featured_events" fe
        WHERE fe."eventId" = "events"."id"
          AND fe."canceledAt" IS NULL
          AND now() BETWEEN fe."startsAt" AND fe."endsAt"
      )
  `

  return { deactivated, activated }
}

let timer: NodeJS.Timeout | null = null
let isReconciling = false

export function startFeaturedEventsReconciler(intervalMs: number) {
  if (timer) return
  timer = setInterval(() => {
    // Evita sobreposição de ticks na mesma instância: se um reconcile
    // ainda está rodando (interval menor que tempo de execução), pula.
    if (isReconciling) return
    isReconciling = true
    reconcileFeaturedEvents()
      .catch((err) => {
        console.error('[featured-events] reconciliation failed:', err)
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
