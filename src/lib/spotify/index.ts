import { env } from '../env'
import { AppError } from '../errors/app-error'
import type { ISpotifyClient } from './spotify.interface'
import { SpotifyApiService } from './spotify.service'

let instance: ISpotifyClient | null = null

/**
 * Resolve o cliente do Spotify pela env (lazy). NUNCA no escopo de módulo —
 * chame dentro do service para o setSpotifyClient dos testes vencer. Sem as
 * credenciais, lança 500 (mal configurado, não é culpa do usuário) em vez de
 * quebrar o boot: a feature é aditiva e o resto da API segue de pé.
 */
export function getSpotifyClient(): ISpotifyClient {
  if (instance) return instance
  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) {
    throw new AppError(500, 'SOCIAL_PROVIDER_MISCONFIGURED')
  }
  instance = new SpotifyApiService(
    env.SPOTIFY_CLIENT_ID,
    env.SPOTIFY_CLIENT_SECRET,
  )
  return instance
}

/** Permite injetar um cliente do Spotify customizado em testes. */
export function setSpotifyClient(client: ISpotifyClient): void {
  instance = client
}

export * from './spotify.interface'
