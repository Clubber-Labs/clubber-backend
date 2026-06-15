import { z } from 'zod'

/**
 * POST /billing/checkout não tem body obrigatório — usa price e URLs
 * configuradas no env. Aceita opcionalmente sobrescrever success/cancel
 * URLs (útil pra testar redirecionamento pro frontend de outro ambiente).
 */
export const createCheckoutBodySchema = z
  .object({
    successUrl: z.url().optional(),
    cancelUrl: z.url().optional(),
  })
  .optional()

export type CreateCheckoutBody = z.infer<typeof createCheckoutBodySchema>

/**
 * Contrato do GET /billing/plan — exatamente os 6 campos da tela de upgrade.
 * amount em centavos e currency vêm do Stripe; trialDays/trialEligible do
 * service. Formaliza o response pra gerar Swagger e validar a saída.
 */
export const planResponseSchema = z.object({
  amount: z.number().int(),
  currency: z.string(),
  interval: z.string(),
  intervalCount: z.number().int(),
  trialDays: z.number().int(),
  trialEligible: z.boolean(),
})

/** Espelha o enum SubscriptionStatus do Prisma (schema.prisma). */
const subscriptionStatusSchema = z.enum([
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'CANCELED',
  'INCOMPLETE',
  'INCOMPLETE_EXPIRED',
  'UNPAID',
])

/**
 * Contrato do GET /billing/subscription. Paridade total com a linha do banco
 * (inclui campos internos como lastSyncedAt/stripeSubscriptionId) — formaliza
 * o que o endpoint JÁ devolve, sem alterar o output e sem quebrar o app.
 */
export const subscriptionResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  stripeSubscriptionId: z.string(),
  stripePriceId: z.string(),
  status: subscriptionStatusSchema,
  trialEndsAt: z.date().nullable(),
  currentPeriodStart: z.date(),
  currentPeriodEnd: z.date(),
  cancelAtPeriodEnd: z.boolean(),
  canceledAt: z.date().nullable(),
  defaultPaymentMethodId: z.string().nullable(),
  startedAt: z.date(),
  lastSyncedAt: z.date(),
  createdAt: z.date(),
  updatedAt: z.date(),
})
