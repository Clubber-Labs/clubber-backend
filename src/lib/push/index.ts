import { env } from '../env'
import { ExpoPushService } from './expo-push.service'
import type { IPushService } from './push.interface'

let instance: IPushService | null = null

/**
 * Resolve o serviço de push pela env (lazy). NUNCA lança no load. Chame SEMPRE
 * dentro do service/worker (não no escopo de módulo) para o setPushService dos
 * testes vencer. Espelha o getMailer.
 *
 * CONTRATO: esta factory NÃO checa o master switch. O `NOTIFICATIONS_ENABLED`
 * é responsabilidade do caller (camada de dispatch/worker), que decide se chega
 * a enfileirar/enviar — chamar `send()` aqui SEMPRE tenta entregar de verdade.
 * Em teste, o setup.ts injeta o FakePushService via setPushService, então
 * `getPushService()` nunca instancia o ExpoPushService real.
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
