import { afterAll, describe, expect, it } from 'vitest'
import { makeWebhookEvent } from '../../test/factories'
import { testPrisma } from '../../test/prisma'
import { reconcileBillingWebhookRetention } from './billing-retention.reconciler'

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
})
