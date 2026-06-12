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
