import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeUser } from '../../test/factories'
import { testPrisma } from '../../test/prisma'
import {
  startLocationRetentionReconciler,
  stopLocationRetentionReconciler,
} from './location-retention.reconciler'
import {
  startNotificationRetentionReconciler,
  stopNotificationRetentionReconciler,
} from './notification-retention.reconciler'
import {
  startPromotedDigestReconciler,
  stopPromotedDigestReconciler,
} from './promoted-digest.reconciler'
import {
  startPushReceiptsReconciler,
  stopPushReceiptsReconciler,
} from './push-receipts.reconciler'
import {
  startSpotLifecycleReconciler,
  stopSpotLifecycleReconciler,
} from './spot-lifecycle.reconciler'

// As funções de processamento de cada reconciler já são testadas direto
// (notifications.test.ts, location-proximity.test.ts, proximity-fanout.test.ts,
// spot-lifecycle.test.ts, promoted-digest.test.ts). O que faltava cobertura é a
// GERÊNCIA DO TIMER (start/stop): guarda de singleton, unref e re-arme após stop.

const INTERVAL = 60_000
const fakeTimer = () => ({ unref: () => {} }) as unknown as NodeJS.Timeout

// Cada start tem assinatura própria; encapsular em thunks permite varrer o
// contrato comum de timer de forma uniforme.
const RECONCILERS = [
  {
    name: 'location-retention',
    start: () => startLocationRetentionReconciler(INTERVAL, 90),
    stop: stopLocationRetentionReconciler,
  },
  {
    name: 'notification-retention',
    start: () => startNotificationRetentionReconciler(INTERVAL, 180),
    stop: stopNotificationRetentionReconciler,
  },
  {
    name: 'push-receipts',
    start: () => startPushReceiptsReconciler(INTERVAL, 1000),
    stop: stopPushReceiptsReconciler,
  },
  {
    name: 'promoted-digest',
    start: () => startPromotedDigestReconciler(INTERVAL),
    stop: stopPromotedDigestReconciler,
  },
  {
    name: 'spot-lifecycle',
    start: () => startSpotLifecycleReconciler(INTERVAL, 60 * 60 * 1000),
    stop: stopSpotLifecycleReconciler,
  },
] as const

describe.each(RECONCILERS)('$name reconciler — gerência de timer', ({
  start,
  stop,
}) => {
  afterEach(() => {
    stop() // zera o singleton do módulo entre os testes
    vi.restoreAllMocks()
  })

  it('agenda um único intervalo e ignora start duplicado (guarda de singleton)', () => {
    const setSpy = vi
      .spyOn(globalThis, 'setInterval')
      .mockReturnValue(fakeTimer())

    start()
    start() // já rodando → não pode reagendar (senão dois ticks concorrentes)

    expect(setSpy).toHaveBeenCalledTimes(1)
    expect(setSpy.mock.calls[0][1]).toBe(INTERVAL)
  })

  it('desarma o event loop com unref (não segura o processo vivo)', () => {
    const unref = vi.fn()
    vi.spyOn(globalThis, 'setInterval').mockReturnValue({
      unref,
    } as unknown as NodeJS.Timeout)

    start()

    expect(unref).toHaveBeenCalledTimes(1)
  })

  it('stop limpa o timer e permite reagendar depois', () => {
    const setSpy = vi
      .spyOn(globalThis, 'setInterval')
      .mockReturnValue(fakeTimer())
    const clearSpy = vi
      .spyOn(globalThis, 'clearInterval')
      .mockImplementation(() => {})

    start()
    stop()
    expect(clearSpy).toHaveBeenCalledTimes(1)

    start() // após o stop o singleton foi liberado → reagenda
    expect(setSpy).toHaveBeenCalledTimes(2)
  })
})

describe('fiação start → trabalho: o tick agendado delega ao reconcile', () => {
  afterEach(() => {
    stopNotificationRetentionReconciler()
    vi.restoreAllMocks()
  })

  it('purga notificação vencida quando o callback do intervalo dispara', async () => {
    // Captura o callback passado ao setInterval sem deixar o timer real agendar,
    // e dispara um tick manualmente — prova que o start de fato fia o reconcile
    // (não um no-op), sem depender de esperar o intervalo real de produção.
    let tick: () => void = () => {}
    vi.spyOn(globalThis, 'setInterval').mockImplementation((fn) => {
      tick = fn as () => void
      return fakeTimer()
    })

    const user = await makeUser()
    const old = await testPrisma.notification.create({
      data: {
        userId: user.id,
        type: 'EVENT_COMMENT',
        title: 'velha',
        body: 'corpo',
        dedupeKey: `ret-${user.id}`,
        createdAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000), // 200 dias
      },
    })

    startNotificationRetentionReconciler(INTERVAL, 180) // TTL 180 dias
    tick()

    await vi.waitFor(async () => {
      const found = await testPrisma.notification.findUnique({
        where: { id: old.id },
      })
      expect(found).toBeNull()
    })
  })
})
