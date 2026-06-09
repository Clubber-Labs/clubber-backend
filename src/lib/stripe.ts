import Stripe from 'stripe'
import { env } from './env'

/**
 * Cliente Stripe singleton. Versão de API fixada para evitar drift quando
 * o SDK é atualizado. `timeout` aborta chamadas presas; `maxNetworkRetries`
 * cobre falhas transientes 5xx com backoff exponencial (feito pelo SDK).
 */
export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: '2026-05-27.dahlia',
  timeout: 10_000,
  maxNetworkRetries: 2,
})
