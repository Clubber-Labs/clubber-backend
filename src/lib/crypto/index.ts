import { env } from '../env'
import { EnvKeyProvider } from './env-key-provider.service'
import type { IKeyProvider } from './key-provider.interface'

let instance: IKeyProvider | null = null

export function getKeyProvider(): IKeyProvider {
  if (instance) return instance

  instance = new EnvKeyProvider(env.CHAT_KEKS, env.CHAT_KEK_ACTIVE_VERSION)

  return instance
}

/** Permite injetar um provider customizado em testes. */
export function setKeyProvider(provider: IKeyProvider): void {
  instance = provider
}

export * from './key-provider.interface'
