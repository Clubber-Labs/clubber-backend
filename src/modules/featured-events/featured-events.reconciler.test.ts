import { afterAll, describe, expect, it } from 'vitest'
import { makeEvent, makeFeaturedEvent, makeUser } from '../../test/factories'
import { testPrisma } from '../../test/prisma'
import { describeReconcilerTimer } from '../../test/reconciler-lifecycle'
import {
  reconcileFeaturedEvents,
  startFeaturedEventsReconciler,
  stopFeaturedEventsReconciler,
} from './featured-events.reconciler'

afterAll(async () => {
  await testPrisma.$disconnect()
})

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000)
const hoursAhead = (h: number) => new Date(Date.now() + h * 3600_000)

async function isFeatured(eventId: string) {
  const e = await testPrisma.event.findUnique({
    where: { id: eventId },
    select: { isFeatured: true },
  })
  return e?.isFeatured
}

// O .test.ts do módulo já cobre o liga/desliga básico; aqui exercitamos as
// janelas canceladas, o lote misto e a idempotência.
describe('reconcileFeaturedEvents', () => {
  it('desliga isFeatured quando a única janela está cancelada', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id, { isFeatured: true })
    await makeFeaturedEvent(event.id, author.id, {
      startsAt: hoursAgo(1),
      endsAt: hoursAhead(1),
      canceledAt: new Date(), // cancelada → não conta como janela ativa
    })

    const result = await reconcileFeaturedEvents()

    expect(result.deactivated).toBe(1)
    expect(await isFeatured(event.id)).toBe(false)
  })

  it('lote misto: liga um e desliga outro no mesmo tick', async () => {
    const author = await makeUser()
    // Precisa ligar: flag false, janela ativa agora.
    const toActivate = await makeEvent(author.id, { isFeatured: false })
    await makeFeaturedEvent(toActivate.id, author.id, {
      startsAt: hoursAgo(1),
      endsAt: hoursAhead(1),
    })
    // Precisa desligar: flag true, janela já expirou.
    const toDeactivate = await makeEvent(author.id, { isFeatured: true })
    await makeFeaturedEvent(toDeactivate.id, author.id, {
      startsAt: hoursAgo(3),
      endsAt: hoursAgo(1),
    })

    const result = await reconcileFeaturedEvents()

    expect(result).toMatchObject({ activated: 1, deactivated: 1 })
    expect(await isFeatured(toActivate.id)).toBe(true)
    expect(await isFeatured(toDeactivate.id)).toBe(false)
  })

  it('idempotência: segundo tick não mexe em nada', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id, { isFeatured: false })
    await makeFeaturedEvent(event.id, author.id, {
      startsAt: hoursAgo(1),
      endsAt: hoursAhead(1),
    })

    const first = await reconcileFeaturedEvents()
    expect(first.activated).toBe(1)
    const second = await reconcileFeaturedEvents()
    expect(second).toMatchObject({ activated: 0, deactivated: 0 })
  })
})

describeReconcilerTimer('featured-events', {
  start: () => startFeaturedEventsReconciler(60_000),
  stop: stopFeaturedEventsReconciler,
  intervalMs: 60_000,
})
