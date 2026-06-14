import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  extractCustomerId,
  extractSetupIntentRefs,
  isEventOlder,
  mapStatus,
  mapStripeSubscription,
  type StripeSubscriptionLike,
} from './billing.mapper'

// O mapper loga console.warn em payloads anômalos (sem priceId / sem período).
// É comportamento esperado e testado — silenciamos pra não poluir a saída.
beforeAll(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterAll(() => {
  vi.restoreAllMocks()
})

function makeSub(
  overrides: Partial<StripeSubscriptionLike> = {},
): StripeSubscriptionLike {
  return {
    id: 'sub_1',
    customer: 'cus_1',
    status: 'active',
    items: {
      data: [
        {
          price: { id: 'price_1' },
          current_period_start: 1_700_000_000,
          current_period_end: 1_700_086_400,
        },
      ],
    },
    cancel_at_period_end: false,
    ...overrides,
  }
}

describe('mapStatus', () => {
  it('mapeia status conhecidos do Stripe pro enum', () => {
    expect(mapStatus('trialing')).toBe('TRIALING')
    expect(mapStatus('active')).toBe('ACTIVE')
    expect(mapStatus('past_due')).toBe('PAST_DUE')
    expect(mapStatus('canceled')).toBe('CANCELED')
    expect(mapStatus('incomplete')).toBe('INCOMPLETE')
    expect(mapStatus('incomplete_expired')).toBe('INCOMPLETE_EXPIRED')
    expect(mapStatus('unpaid')).toBe('UNPAID')
  })

  it('cai pra INCOMPLETE em status desconhecido', () => {
    expect(mapStatus('paused')).toBe('INCOMPLETE')
    expect(mapStatus('')).toBe('INCOMPLETE')
  })
})

describe('mapStripeSubscription', () => {
  it('retorna null quando não há priceId (payload anômalo, não acionável)', () => {
    expect(mapStripeSubscription(makeSub({ items: { data: [] } }))).toBeNull()
    expect(mapStripeSubscription(makeSub({ items: undefined }))).toBeNull()
  })

  it('lê current_period_* do item (Stripe API 2025+)', () => {
    const fields = mapStripeSubscription(makeSub())
    if (!fields) throw new Error('esperava fields não-nulo')
    expect(fields.stripePriceId).toBe('price_1')
    expect(fields.status).toBe('ACTIVE')
    expect(fields.currentPeriodStart).toEqual(new Date(1_700_000_000 * 1000))
    expect(fields.currentPeriodEnd).toEqual(new Date(1_700_086_400 * 1000))
  })

  it('faz fallback de current_period_* pro nível raiz (API antiga / fixtures)', () => {
    const fields = mapStripeSubscription(
      makeSub({
        items: { data: [{ price: { id: 'price_x' } }] },
        current_period_start: 1_600_000_000,
        current_period_end: 1_600_086_400,
      }),
    )
    if (!fields) throw new Error('esperava fields não-nulo')
    expect(fields.stripePriceId).toBe('price_x')
    expect(fields.currentPeriodStart).toEqual(new Date(1_600_000_000 * 1000))
    expect(fields.currentPeriodEnd).toEqual(new Date(1_600_086_400 * 1000))
  })

  it('usa trial_end como fallback do periodEnd e preenche trialEndsAt', () => {
    const fields = mapStripeSubscription(
      makeSub({
        status: 'trialing',
        items: { data: [{ price: { id: 'price_x' } }] },
        current_period_start: null,
        current_period_end: null,
        trial_end: 1_700_500_000,
      }),
    )
    if (!fields) throw new Error('esperava fields não-nulo')
    expect(fields.status).toBe('TRIALING')
    expect(fields.trialEndsAt).toEqual(new Date(1_700_500_000 * 1000))
    expect(fields.currentPeriodEnd).toEqual(new Date(1_700_500_000 * 1000))
    // periodStart sem dado nenhum cai no now() — precisa ser Date válida.
    expect(Number.isNaN(fields.currentPeriodStart.getTime())).toBe(false)
  })

  it('sem período nem trial_end, usa now() válido (evita Invalid Date)', () => {
    const fields = mapStripeSubscription(
      makeSub({
        items: { data: [{ price: { id: 'price_x' } }] },
        current_period_start: null,
        current_period_end: null,
        trial_end: null,
      }),
    )
    if (!fields) throw new Error('esperava fields não-nulo')
    expect(Number.isNaN(fields.currentPeriodStart.getTime())).toBe(false)
    expect(Number.isNaN(fields.currentPeriodEnd.getTime())).toBe(false)
  })

  it('mapeia cancelAtPeriodEnd e canceledAt', () => {
    const fields = mapStripeSubscription(
      makeSub({ cancel_at_period_end: true, canceled_at: 1_700_200_000 }),
    )
    if (!fields) throw new Error('esperava fields não-nulo')
    expect(fields.cancelAtPeriodEnd).toBe(true)
    expect(fields.canceledAt).toEqual(new Date(1_700_200_000 * 1000))
  })

  it('canceledAt e trialEndsAt null quando ausentes', () => {
    const fields = mapStripeSubscription(makeSub())
    if (!fields) throw new Error('esperava fields não-nulo')
    expect(fields.canceledAt).toBeNull()
    expect(fields.trialEndsAt).toBeNull()
  })

  it('mapeia default_payment_method (string, objeto, ausente) → defaultPaymentMethodId', () => {
    expect(
      mapStripeSubscription(makeSub({ default_payment_method: 'pm_str' }))
        ?.defaultPaymentMethodId,
    ).toBe('pm_str')
    expect(
      mapStripeSubscription(
        makeSub({ default_payment_method: { id: 'pm_obj' } }),
      )?.defaultPaymentMethodId,
    ).toBe('pm_obj')
    // Trial do PaymentSheet nasce sem cartão → null (o gate do premium).
    expect(
      mapStripeSubscription(makeSub({ default_payment_method: null }))
        ?.defaultPaymentMethodId,
    ).toBeNull()
    expect(mapStripeSubscription(makeSub())?.defaultPaymentMethodId).toBeNull()
  })
})

describe('extractCustomerId', () => {
  it('extrai de customer como string', () => {
    expect(extractCustomerId(makeSub({ customer: 'cus_abc' }))).toBe('cus_abc')
  })

  it('extrai de customer como objeto', () => {
    expect(extractCustomerId(makeSub({ customer: { id: 'cus_obj' } }))).toBe(
      'cus_obj',
    )
  })

  it('retorna null quando customer ausente (payload anômalo)', () => {
    expect(extractCustomerId(makeSub({ customer: null }))).toBeNull()
    expect(extractCustomerId(makeSub({ customer: undefined }))).toBeNull()
  })
})

describe('extractSetupIntentRefs', () => {
  it('extrai customer + payment_method (string e objeto)', () => {
    expect(
      extractSetupIntentRefs({ customer: 'cus_1', payment_method: 'pm_1' }),
    ).toEqual({ customerId: 'cus_1', paymentMethodId: 'pm_1' })
    expect(
      extractSetupIntentRefs({
        customer: { id: 'cus_2' },
        payment_method: { id: 'pm_2' },
      }),
    ).toEqual({ customerId: 'cus_2', paymentMethodId: 'pm_2' })
  })

  it('retorna null se faltar customer ou payment_method', () => {
    expect(
      extractSetupIntentRefs({ customer: null, payment_method: 'pm_1' }),
    ).toBeNull()
    expect(
      extractSetupIntentRefs({ customer: 'cus_1', payment_method: null }),
    ).toBeNull()
  })
})

describe('isEventOlder', () => {
  it('true quando event é estritamente mais antigo (precisão de segundos)', () => {
    expect(
      isEventOlder(new Date(1_700_000_000_000), new Date(1_700_000_001_000)),
    ).toBe(true)
  })

  it('false quando event é mais novo', () => {
    expect(
      isEventOlder(new Date(1_700_000_002_000), new Date(1_700_000_001_000)),
    ).toBe(false)
  })

  it('false no mesmo segundo (diferença sub-segundo não descarta evento)', () => {
    expect(
      isEventOlder(new Date(1_700_000_000_400), new Date(1_700_000_000_900)),
    ).toBe(false)
  })
})
