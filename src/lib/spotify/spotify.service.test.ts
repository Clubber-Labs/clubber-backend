import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppError } from '../errors/app-error'
import { SpotifyApiService } from './spotify.service'

const service = new SpotifyApiService('client-id', 'client-secret')

function mockJson(body: unknown, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

async function captureError(fn: () => Promise<unknown>): Promise<AppError> {
  try {
    await fn()
  } catch (err) {
    return err as AppError
  }
  throw new Error('esperava um AppError')
}

afterEach(() => vi.restoreAllMocks())

describe('exchangeCode', () => {
  it('envia o code com PKCE e Basic auth, e devolve os escopos concedidos', async () => {
    const spy = mockJson({
      access_token: 'access-123',
      refresh_token: 'refresh-123',
      scope: 'user-top-read user-follow-read',
      expires_in: 3600,
    })

    const grant = await service.exchangeCode(
      'code-abc',
      'verifier-xyz',
      'clubber://spotify-callback',
    )

    expect(grant).toEqual({
      accessToken: 'access-123',
      refreshToken: 'refresh-123',
      scopes: ['user-top-read', 'user-follow-read'],
      expiresIn: 3600,
    })

    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://accounts.spotify.com/api/token')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`,
    )
    const body = new URLSearchParams(init.body as string)
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('code-abc')
    expect(body.get('code_verifier')).toBe('verifier-xyz')
    expect(body.get('redirect_uri')).toBe('clubber://spotify-callback')
    // O secret vai no header, nunca no corpo.
    expect(body.get('client_secret')).toBeNull()
  })

  it('trata invalid_grant como token inválido (401)', async () => {
    mockJson({ error: 'invalid_grant' }, 400)

    const err = await captureError(() =>
      service.exchangeCode('expirado', 'verifier', 'clubber://cb'),
    )
    expect(err.statusCode).toBe(401)
    expect(err.code).toBe('INVALID_PROVIDER_TOKEN')
  })

  it('trata falha de rede como indisponibilidade (503)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('timeout'))

    const err = await captureError(() =>
      service.exchangeCode('code', 'verifier', 'clubber://cb'),
    )
    expect(err.statusCode).toBe(503)
    expect(err.code).toBe('SOCIAL_PROVIDER_UNAVAILABLE')
  })

  it('trata resposta sem tokens como resposta inválida (502)', async () => {
    mockJson({ access_token: 'só-access' })

    const err = await captureError(() =>
      service.exchangeCode('code', 'verifier', 'clubber://cb'),
    )
    expect(err.statusCode).toBe(502)
  })
})

describe('refreshAccessToken', () => {
  it('devolve o token novo e propaga a rotação do refresh', async () => {
    mockJson({
      access_token: 'access-novo',
      refresh_token: 'refresh-rotacionado',
      expires_in: 3600,
    })

    await expect(service.refreshAccessToken('refresh-antigo')).resolves.toEqual(
      {
        kind: 'ok',
        accessToken: 'access-novo',
        refreshToken: 'refresh-rotacionado',
      },
    )
  })

  it('devolve refreshToken null quando o Spotify não rotaciona', async () => {
    mockJson({ access_token: 'access-novo', expires_in: 3600 })

    await expect(service.refreshAccessToken('refresh-antigo')).resolves.toEqual(
      {
        kind: 'ok',
        accessToken: 'access-novo',
        refreshToken: null,
      },
    )
  })

  it('devolve revoked (sem lançar) quando o usuário revogou o app', async () => {
    mockJson({ error: 'invalid_grant' }, 400)

    await expect(service.refreshAccessToken('revogado')).resolves.toEqual({
      kind: 'revoked',
    })
  })

  it('lança 429 no rate limit, para o sync poder abortar o lote', async () => {
    mockJson({ error: 'too_many_requests' }, 429)

    const err = await captureError(() => service.refreshAccessToken('token'))
    expect(err.statusCode).toBe(429)
    expect(err.code).toBe('SPOTIFY_RATE_LIMITED')
  })
})

describe('getMe', () => {
  it('devolve id e nome de exibição', async () => {
    const spy = mockJson({ id: 'spotify-user-1', display_name: 'Neto' })

    await expect(service.getMe('access-123')).resolves.toEqual({
      id: 'spotify-user-1',
      displayName: 'Neto',
    })

    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.spotify.com/v1/me')
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer access-123',
    )
  })

  it('aceita conta sem display_name', async () => {
    mockJson({ id: 'spotify-user-2' })

    await expect(service.getMe('access')).resolves.toEqual({
      id: 'spotify-user-2',
      displayName: null,
    })
  })

  it('trata resposta sem id como inválida (502)', async () => {
    mockJson({ display_name: 'sem id' })

    const err = await captureError(() => service.getMe('access'))
    expect(err.statusCode).toBe(502)
  })
})

describe('getTopArtists', () => {
  it('pede a janela e o limite, e mapeia os artistas', async () => {
    const spy = mockJson({
      items: [
        {
          id: 'artist-1',
          name: 'Alok',
          genres: ['brazilian bass', 'edm'],
          images: [
            { url: 'https://i.scdn.co/grande.jpg', width: 640 },
            { url: 'https://i.scdn.co/media.jpg', width: 320 },
          ],
        },
        { id: 'artist-2', name: 'DJ Local', genres: [], images: [] },
      ],
    })

    const artists = await service.getTopArtists('access', 'medium_term', 50)

    expect(artists).toEqual([
      {
        id: 'artist-1',
        name: 'Alok',
        imageUrl: 'https://i.scdn.co/grande.jpg',
        genres: ['brazilian bass', 'edm'],
      },
      { id: 'artist-2', name: 'DJ Local', imageUrl: null, genres: [] },
    ])

    const [url] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('time_range=medium_term')
    expect(url).toContain('limit=50')
  })

  it('ignora item sem id em vez de derrubar o sync inteiro', async () => {
    mockJson({ items: [{ name: 'sem id' }, { id: 'ok', name: 'Válido' }] })

    const artists = await service.getTopArtists('access', 'medium_term', 50)
    expect(artists).toHaveLength(1)
    expect(artists[0].id).toBe('ok')
  })

  it('trata token expirado como token inválido (401)', async () => {
    mockJson({ error: { status: 401 } }, 401)

    const err = await captureError(() =>
      service.getTopArtists('expirado', 'medium_term', 50),
    )
    expect(err.statusCode).toBe(401)
  })
})
