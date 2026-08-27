import { AppError } from '../errors/app-error'
import { spotifyApiCallsTotal } from '../metrics'
import type {
  ISpotifyClient,
  SpotifyAccount,
  SpotifyArtist,
  SpotifyRefreshResult,
  SpotifyTimeRange,
  SpotifyTokenGrant,
} from './spotify.interface'

const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token'
const API_BASE = 'https://api.spotify.com/v1'
const REQUEST_TIMEOUT_MS = 5000

type TokenResponse = {
  access_token?: string
  refresh_token?: string
  scope?: string
  expires_in?: number
  error?: string
}

type ArtistResponse = {
  items?: {
    id?: string
    name?: string
    genres?: string[]
    images?: { url?: string; width?: number }[]
  }[]
}

export class SpotifyApiService implements ISpotifyClient {
  private readonly basicAuth: string

  constructor(clientId: string, clientSecret: string) {
    this.basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
      'base64',
    )
  }

  async exchangeCode(
    code: string,
    codeVerifier: string,
    redirectUri: string,
  ): Promise<SpotifyTokenGrant> {
    const data = await this.postToken(
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      },
      'exchange',
    )

    if (data.kind === 'invalid_grant') {
      throw new AppError(401, 'INVALID_PROVIDER_TOKEN')
    }
    const { access_token, refresh_token, scope, expires_in } = data.body
    // Sem refresh token não há vínculo possível: só o access, que morre em 1h.
    if (!access_token || !refresh_token) {
      throw new AppError(502, 'SOCIAL_PROVIDER_UNAVAILABLE')
    }
    return {
      accessToken: access_token,
      refreshToken: refresh_token,
      scopes: scope ? scope.split(' ').filter(Boolean) : [],
      expiresIn: expires_in ?? 3600,
    }
  }

  async refreshAccessToken(
    refreshToken: string,
  ): Promise<SpotifyRefreshResult> {
    const data = await this.postToken(
      { grant_type: 'refresh_token', refresh_token: refreshToken },
      'refresh',
    )

    // Revogação é desfecho, não falha: o sync marca o vínculo e segue o lote.
    if (data.kind === 'invalid_grant') return { kind: 'revoked' }

    const { access_token, refresh_token } = data.body
    if (!access_token) {
      throw new AppError(502, 'SOCIAL_PROVIDER_UNAVAILABLE')
    }
    return {
      kind: 'ok',
      accessToken: access_token,
      // Ausente = o Spotify não rotacionou; o token guardado continua valendo.
      refreshToken: refresh_token ?? null,
    }
  }

  async getMe(accessToken: string): Promise<SpotifyAccount> {
    const data = await this.get<{ id?: string; display_name?: string }>(
      '/me',
      accessToken,
      'me',
    )
    if (!data.id) throw new AppError(502, 'SOCIAL_PROVIDER_UNAVAILABLE')
    return { id: data.id, displayName: data.display_name ?? null }
  }

  async getTopArtists(
    accessToken: string,
    timeRange: SpotifyTimeRange,
    limit: number,
  ): Promise<SpotifyArtist[]> {
    const data = await this.get<ArtistResponse>(
      `/me/top/artists?time_range=${timeRange}&limit=${limit}`,
      accessToken,
      'top_artists',
    )
    return (data.items ?? [])
      .filter((a): a is { id: string } & typeof a => !!a.id)
      .map((a) => ({
        id: a.id,
        name: a.name ?? 'Artista',
        // O Spotify devolve as imagens da maior para a menor.
        imageUrl: a.images?.[0]?.url ?? null,
        genres: a.genres ?? [],
      }))
  }

  /**
   * POST no endpoint de token. O client_secret vai no header Basic (nunca no
   * corpo) e `invalid_grant` sobe como desfecho para o chamador decidir: no
   * exchange é code inválido (401), no refresh é revogação.
   */
  private async postToken(
    params: Record<string, string>,
    endpoint: string,
  ): Promise<{ kind: 'ok'; body: TokenResponse } | { kind: 'invalid_grant' }> {
    const res = await this.request(
      TOKEN_ENDPOINT,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${this.basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(params).toString(),
      },
      endpoint,
    )

    const body = await this.parseJson<TokenResponse>(res, endpoint)
    if (res.ok) return { kind: 'ok', body }
    if (body.error === 'invalid_grant') return { kind: 'invalid_grant' }
    throw this.statusError(res.status, endpoint)
  }

  private async get<T>(
    path: string,
    accessToken: string,
    endpoint: string,
  ): Promise<T> {
    const res = await this.request(
      `${API_BASE}${path}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      endpoint,
    )
    if (!res.ok) throw this.statusError(res.status, endpoint)
    return this.parseJson<T>(res, endpoint)
  }

  /** fetch com timeout; falha de rede/timeout vira 503 (indisponível). */
  private async request(
    url: string,
    init: RequestInit,
    endpoint: string,
  ): Promise<Response> {
    try {
      const res = await fetch(url, {
        ...init,
        // Sem timeout, lentidão do Spotify penduraria o handler (o Fastify não
        // tem timeout de resposta) e travaria o tick do sync.
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      spotifyApiCallsTotal.inc({ endpoint, outcome: String(res.status) })
      return res
    } catch {
      spotifyApiCallsTotal.inc({ endpoint, outcome: 'network_error' })
      throw new AppError(503, 'SOCIAL_PROVIDER_UNAVAILABLE')
    }
  }

  private async parseJson<T>(res: Response, endpoint: string): Promise<T> {
    try {
      return (await res.json()) as T
    } catch {
      spotifyApiCallsTotal.inc({ endpoint, outcome: 'invalid_json' })
      throw new AppError(502, 'SOCIAL_PROVIDER_UNAVAILABLE')
    }
  }

  /**
   * 429 é distinto: o sync precisa reconhecê-lo para abortar o lote em vez de
   * queimar a cota item a item. 401 é token morto (o chamador revincula).
   */
  private statusError(status: number, endpoint: string): AppError {
    if (status === 429) return new AppError(429, 'SPOTIFY_RATE_LIMITED')
    if (status === 401) return new AppError(401, 'INVALID_PROVIDER_TOKEN')
    return new AppError(502, 'SOCIAL_PROVIDER_UNAVAILABLE', undefined, {
      status,
      endpoint,
    })
  }
}
