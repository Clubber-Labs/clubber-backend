import { env } from '../env'
import { AppError } from '../errors/app-error'
import { GooglePlacesService } from './google-places.service'
import type { IPlacesClient } from './places.interface'

let instance: IPlacesClient | null = null

/**
 * Resolve o cliente de Places pela env (lazy). NUNCA no escopo de módulo —
 * chame dentro do service para o setPlacesClient dos testes vencer. Sem a chave,
 * lança 503 (feature indisponível) em vez de quebrar no boot. Espelha o getPushService.
 */
export function getPlacesClient(): IPlacesClient {
  if (instance) return instance
  if (!env.GOOGLE_PLACES_API_KEY) {
    throw new AppError(503, 'PLACES_UNAVAILABLE')
  }
  instance = new GooglePlacesService(env.GOOGLE_PLACES_API_KEY)
  return instance
}

/** Permite injetar um cliente de Places customizado em testes. */
export function setPlacesClient(client: IPlacesClient): void {
  instance = client
}

export * from './places.interface'
