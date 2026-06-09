import { env } from '../env'
import { ExpoPushService } from './expo-push.service'
import type { IPushService } from './push.interface'

let instance: IPushService | null = null

/**
 * Resolve o serviço de push pela env (lazy). NUNCA lança no load. Chame SEMPRE
 * dentro do service/worker (não no escopo de módulo) para o setPushService dos
 * testes vencer. Espelha o getMailer.
 */
export function getPushService(): IPushService {
  if (instance) return instance
  instance = new ExpoPushService(env.EXPO_ACCESS_TOKEN)
  return instance
}

/** Permite injetar um serviço de push customizado em testes. */
export function setPushService(svc: IPushService): void {
  instance = svc
}

export * from './push.interface'
