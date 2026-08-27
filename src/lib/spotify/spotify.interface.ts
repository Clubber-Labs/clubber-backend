/** Janelas do /me/top/artists: ~4 semanas, ~6 meses, ~1 ano. */
export type SpotifyTimeRange = 'short_term' | 'medium_term' | 'long_term'

/** Resultado da troca do authorization code por tokens. */
export type SpotifyTokenGrant = {
  accessToken: string
  refreshToken: string
  /** Escopos REALMENTE concedidos — o usuário pode ter autorizado menos. */
  scopes: string[]
  expiresIn: number
}

/**
 * Refresh é união, não exceção: `revoked` é desfecho esperado (o usuário tirou
 * o app em spotify.com/account/apps) e o sync precisa tratá-lo sem quebrar o
 * lote. `refreshToken` vem null quando o Spotify não rotacionou — nesse caso o
 * token antigo continua valendo.
 */
export type SpotifyRefreshResult =
  | { kind: 'ok'; accessToken: string; refreshToken: string | null }
  | { kind: 'revoked' }

export type SpotifyArtist = {
  id: string
  name: string
  imageUrl: string | null
  /** Gêneros crus do Spotify ("brazilian bass", "funk carioca"). */
  genres: string[]
}

export type SpotifyAccount = {
  id: string
  displayName: string | null
}

export interface ISpotifyClient {
  exchangeCode(
    code: string,
    codeVerifier: string,
    redirectUri: string,
  ): Promise<SpotifyTokenGrant>
  refreshAccessToken(refreshToken: string): Promise<SpotifyRefreshResult>
  getMe(accessToken: string): Promise<SpotifyAccount>
  getTopArtists(
    accessToken: string,
    timeRange: SpotifyTimeRange,
    limit: number,
  ): Promise<SpotifyArtist[]>
}
