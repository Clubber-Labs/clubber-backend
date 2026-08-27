import type {
  ISpotifyClient,
  SpotifyAccount,
  SpotifyArtist,
  SpotifyRefreshResult,
  SpotifyTimeRange,
  SpotifyTokenGrant,
} from '../lib/spotify'

/**
 * Spotify fake para testes: não chama a API. Cada método tem um `*Override`
 * para roteirizar o cenário (revogação, escopo faltando, artistas específicos)
 * e contadores para verificar quantas chamadas o fluxo realmente fez. Injetado
 * via setSpotifyClient no setup.ts.
 */
export class FakeSpotifyService implements ISpotifyClient {
  exchangeCalls = 0
  lastExchange: {
    code: string
    codeVerifier: string
    redirectUri: string
  } | null = null
  refreshCalls = 0
  lastRefreshToken: string | null = null
  meCalls = 0
  topArtistsCalls = 0
  lastTimeRange: SpotifyTimeRange | null = null

  /** Roteiriza a troca do code (ex.: escopos parciais) ou lança para testar erro. */
  exchangeOverride: ((code: string) => SpotifyTokenGrant) | null = null
  refreshOverride: ((refreshToken: string) => SpotifyRefreshResult) | null =
    null
  meOverride: ((accessToken: string) => SpotifyAccount) | null = null
  topArtistsOverride: ((accessToken: string) => SpotifyArtist[]) | null = null

  async exchangeCode(
    code: string,
    codeVerifier: string,
    redirectUri: string,
  ): Promise<SpotifyTokenGrant> {
    this.exchangeCalls++
    this.lastExchange = { code, codeVerifier, redirectUri }
    if (this.exchangeOverride) return this.exchangeOverride(code)
    return {
      accessToken: `access_${code}`,
      refreshToken: `refresh_${code}`,
      scopes: ['user-top-read', 'user-follow-read', 'playlist-read-private'],
      expiresIn: 3600,
    }
  }

  async refreshAccessToken(
    refreshToken: string,
  ): Promise<SpotifyRefreshResult> {
    this.refreshCalls++
    this.lastRefreshToken = refreshToken
    if (this.refreshOverride) return this.refreshOverride(refreshToken)
    return {
      kind: 'ok',
      accessToken: `access_de_${refreshToken}`,
      refreshToken: null,
    }
  }

  async getMe(accessToken: string): Promise<SpotifyAccount> {
    this.meCalls++
    if (this.meOverride) return this.meOverride(accessToken)
    return { id: 'spotify_fake_user', displayName: 'Usuário Fake' }
  }

  async getTopArtists(
    accessToken: string,
    timeRange: SpotifyTimeRange,
  ): Promise<SpotifyArtist[]> {
    this.topArtistsCalls++
    this.lastTimeRange = timeRange
    if (this.topArtistsOverride) return this.topArtistsOverride(accessToken)
    return [
      {
        id: '0EmeFodog0BfCgMzAIvKQp',
        name: 'Alok',
        imageUrl: 'https://i.scdn.co/alok.jpg',
        genres: ['brazilian bass', 'edm'],
      },
      {
        id: '1uNFoZAHBGtllmzznpCI3s',
        name: 'Anitta',
        imageUrl: null,
        genres: ['funk carioca', 'pop'],
      },
    ]
  }

  reset(): void {
    this.exchangeCalls = 0
    this.lastExchange = null
    this.refreshCalls = 0
    this.lastRefreshToken = null
    this.meCalls = 0
    this.topArtistsCalls = 0
    this.lastTimeRange = null
    this.exchangeOverride = null
    this.refreshOverride = null
    this.meOverride = null
    this.topArtistsOverride = null
  }
}

export const fakeSpotify = new FakeSpotifyService()
