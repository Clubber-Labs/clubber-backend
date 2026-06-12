import Stripe from 'stripe'
import { env } from './env'

/**
 * Versão de API fixada para evitar drift quando o SDK é atualizado.
 * Exportada porque ephemeral keys (PaymentSheet) precisam ser criadas
 * explicitamente nesta mesma versão.
 */
export const STRIPE_API_VERSION = '2026-05-27.dahlia'

/**
 * Cliente Stripe singleton. `timeout` aborta chamadas presas;
 * `maxNetworkRetries` cobre falhas transientes 5xx com backoff
 * exponencial (feito pelo SDK).
 */
export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: STRIPE_API_VERSION,
  timeout: 10_000,
  maxNetworkRetries: 2,
})
