import { afterAll, describe, expect, it } from 'vitest'
import { makeWebhookEvent } from '../../test/factories'
import { testPrisma } from '../../test/prisma'
import { describeReconcilerTimer } from '../../test/reconciler-lifecycle'
import {
  reconcileBillingWebhookRetention,
  startBillingRetentionReconciler,
  stopBillingRetentionReconciler,
} from './billing-retention.reconciler'

afterAll(async () => {
  await testPrisma.$disconnect()
})

function daysAgo(days: number) {
  return new Date(Date.now() - days * 86_400_000)
}

describe('reconcileBillingWebhookRetention', () => {
  it('expurga eventos além do prazo e preserva os recentes', async () => {
    const old1 = await makeWebhookEvent({ processedAt: daysAgo(91) })
    const old2 = await makeWebhookEvent({ processedAt: daysAgo(120) })
    const recent = await makeWebhookEvent({ processedAt: daysAgo(89) })

    const result = await reconcileBillingWebhookRetention(90)

    expect(result.deleted).toBe(2)
    expect(
      await testPrisma.webhookEvent.findUnique({ where: { id: old1.id } }),
    ).toBeNull()
    expect(
      await testPrisma.webhookEvent.findUnique({ where: { id: old2.id } }),
    ).toBeNull()
    // Recente fica: é a janela que garante a idempotência dos retries do Stripe.
    expect(
      await testPrisma.webhookEvent.findUnique({ where: { id: recent.id } }),
    ).not.toBeNull()
  })

  it('é no-op quando nada venceu', async () => {
    await makeWebhookEvent({ processedAt: daysAgo(1) })

    const result = await reconcileBillingWebhookRetention(90)

    expect(result.deleted).toBe(0)
  })

  it('idempotência: segundo run após o expurgo é no-op', async () => {
    await makeWebhookEvent({ processedAt: daysAgo(91) })
    await makeWebhookEvent({ processedAt: daysAgo(100) })
    await makeWebhookEvent({ processedAt: daysAgo(80) })

    const first = await reconcileBillingWebhookRetention(90)
    expect(first.deleted).toBe(2)

    const second = await reconcileBillingWebhookRetention(90)
    expect(second.deleted).toBe(0)
    expect(await testPrisma.webhookEvent.count()).toBe(1)
  })

  it('usa o now injetado e o limiar é exclusivo (< cutoff, não <=)', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    const cutoff = new Date(now.getTime() - 90 * 86_400_000)
    // Exatamente no cutoff NÃO apaga (WHERE usa <).
    const atCutoff = await makeWebhookEvent({ processedAt: cutoff })
    // 1ms antes do cutoff: apaga.
    const justOld = await makeWebhookEvent({
      processedAt: new Date(cutoff.getTime() - 1),
    })
    // Depois do cutoff: fica.
    await makeWebhookEvent({ processedAt: new Date(cutoff.getTime() + 1) })

    const result = await reconcileBillingWebhookRetention(90, now)

    expect(result.deleted).toBe(1)
    expect(
      await testPrisma.webhookEvent.findUnique({ where: { id: justOld.id } }),
    ).toBeNull()
    expect(
      await testPrisma.webhookEvent.findUnique({ where: { id: atCutoff.id } }),
    ).not.toBeNull()
    expect(await testPrisma.webhookEvent.count()).toBe(2)
  })
})

describeReconcilerTimer('billing-retention', {
  start: () => startBillingRetentionReconciler(60_000, 90),
  stop: stopBillingRetentionReconciler,
  intervalMs: 60_000,
})
