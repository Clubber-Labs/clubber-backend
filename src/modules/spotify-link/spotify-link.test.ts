import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { decryptRefreshToken } from '../../lib/spotify/crypto'
import { buildApp } from '../../test/app'
import {
  makeSpotifyLink,
  makeSpotifyTasteSnapshot,
  makeUser,
  makeUserCategoryPreference,
  makeUserSubcategoryPreference,
} from '../../test/factories'
import { fakeSpotify } from '../../test/fake-spotify'
import { testPrisma } from '../../test/prisma'

let app: FastifyInstance

function token(userId: string) {
  return app.jwt.sign({ sub: userId })
}

function auth(userId: string) {
  return { authorization: `Bearer ${token(userId)}` }
}

beforeAll(async () => {
  app = buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await testPrisma.$disconnect()
})

describe('POST /spotify/link', () => {
  it('vincula a conta, cifra o refresh token e importa os gêneros', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'POST',
      url: '/spotify/link',
      headers: auth(user.id),
      body: { code: 'code-123', codeVerifier: 'v'.repeat(43) },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({
      linked: true,
      status: 'ACTIVE',
      displayName: 'Usuário Fake',
    })
    // Alok (brazilian bass, edm) e Anitta (funk carioca, pop).
    expect(res.json().genres).toEqual([
      'GENRE_HOUSE',
      'GENRE_EDM',
      'GENRE_FUNK',
      'GENRE_POP',
    ])
    expect(res.json().artists).toHaveLength(2)
    expect(res.json().artists[0]).toMatchObject({
      name: 'Alok',
      spotifyUrl: 'https://open.spotify.com/artist/0EmeFodog0BfCgMzAIvKQp',
      hidden: false,
    })

    const link = await testPrisma.spotifyLink.findUnique({
      where: { userId: user.id },
    })
    // O token guardado não pode ser legível no banco, mas tem de decifrar.
    expect(link?.refreshTokenEncrypted).not.toContain('refresh_code-123')
    expect(decryptRefreshToken(link?.refreshTokenEncrypted ?? '')).toBe(
      'refresh_code-123',
    )
  })

  it('usa o redirect URI do servidor, não um vindo do cliente', async () => {
    const user = await makeUser()

    await app.inject({
      method: 'POST',
      url: '/spotify/link',
      headers: auth(user.id),
      body: {
        code: 'code-abc',
        codeVerifier: 'v'.repeat(43),
        redirectUri: 'https://site-do-atacante.example/callback',
      },
    })

    expect(fakeSpotify.lastExchange?.redirectUri).toBe(
      'clubber://spotify-callback',
    )
  })

  it('registra o consentimento de dados do Spotify', async () => {
    const user = await makeUser()

    await app.inject({
      method: 'POST',
      url: '/spotify/link',
      headers: auth(user.id),
      body: { code: 'code-1', codeVerifier: 'v'.repeat(43) },
    })

    const consent = await testPrisma.userConsent.findUnique({
      where: { userId: user.id },
    })
    expect(consent?.spotifyData).toBe(true)
  })

  it('recusa quando o usuário não concedeu o escopo de top artists', async () => {
    const user = await makeUser()
    fakeSpotify.exchangeOverride = (code) => ({
      accessToken: `access_${code}`,
      refreshToken: `refresh_${code}`,
      scopes: ['playlist-read-private'],
      expiresIn: 3600,
    })

    const res = await app.inject({
      method: 'POST',
      url: '/spotify/link',
      headers: auth(user.id),
      body: { code: 'code-1', codeVerifier: 'v'.repeat(43) },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('SPOTIFY_SCOPE_MISSING')
    expect(
      await testPrisma.spotifyLink.findUnique({ where: { userId: user.id } }),
    ).toBeNull()
  })

  it('recusa vincular a mesma conta do Spotify a outro perfil', async () => {
    const dono = await makeUser()
    const outro = await makeUser()
    await makeSpotifyLink(dono.id, { spotifyUserId: 'spotify_fake_user' })

    const res = await app.inject({
      method: 'POST',
      url: '/spotify/link',
      headers: auth(outro.id),
      body: { code: 'code-1', codeVerifier: 'v'.repeat(43) },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('SPOTIFY_ACCOUNT_IN_USE')
  })

  it('revincular reativa o vínculo revogado e preserva o dono', async () => {
    const user = await makeUser()
    await makeSpotifyLink(user.id, {
      spotifyUserId: 'spotify_fake_user',
      status: 'REVOKED',
      lastSyncError: 'invalid_grant',
    })

    const res = await app.inject({
      method: 'POST',
      url: '/spotify/link',
      headers: auth(user.id),
      body: { code: 'code-novo', codeVerifier: 'v'.repeat(43) },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().status).toBe('ACTIVE')
    const link = await testPrisma.spotifyLink.findUnique({
      where: { userId: user.id },
    })
    expect(link?.lastSyncError).toBeNull()
  })

  it('rejeita code verifier fora da faixa do RFC 7636', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'POST',
      url: '/spotify/link',
      headers: auth(user.id),
      body: { code: 'code', codeVerifier: 'curto-demais' },
    })

    expect(res.statusCode).toBe(400)
  })

  it('retorna 401 sem autenticação', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/spotify/link',
      body: { code: 'code', codeVerifier: 'v'.repeat(43) },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('GET /spotify/profile', () => {
  it('devolve estado não-vinculado sem erro', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: '/spotify/profile',
      headers: auth(user.id),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      linked: false,
      status: null,
      genres: [],
      artists: [],
    })
  })

  it('marca para o dono quais artistas estão ocultos', async () => {
    const user = await makeUser()
    await makeSpotifyLink(user.id, {
      hiddenArtistIds: ['0EmeFodog0BfCgMzAIvKQp'],
    })
    await makeSpotifyTasteSnapshot(user.id)

    const res = await app.inject({
      method: 'GET',
      url: '/spotify/profile',
      headers: auth(user.id),
    })

    expect(res.json().artists[0]).toMatchObject({
      id: '0EmeFodog0BfCgMzAIvKQp',
      hidden: true,
    })
  })
})

describe('DELETE /spotify/link', () => {
  it('apaga vínculo e snapshot, revoga o consentimento e mantém os interesses', async () => {
    const user = await makeUser()
    await makeSpotifyLink(user.id)
    await makeSpotifyTasteSnapshot(user.id)
    await makeUserSubcategoryPreference(user.id, 'GENRE_HOUSE')

    const res = await app.inject({
      method: 'DELETE',
      url: '/spotify/link',
      headers: auth(user.id),
    })

    expect(res.statusCode).toBe(204)
    expect(
      await testPrisma.spotifyLink.findUnique({ where: { userId: user.id } }),
    ).toBeNull()
    expect(
      await testPrisma.spotifyTasteSnapshot.findUnique({
        where: { userId: user.id },
      }),
    ).toBeNull()
    const consent = await testPrisma.userConsent.findUnique({
      where: { userId: user.id },
    })
    expect(consent?.spotifyData).toBe(false)
    // O interesse aplicado virou escolha do usuário — não some com o unlink.
    expect(
      await testPrisma.userSubcategoryPreference.count({
        where: { userId: user.id },
      }),
    ).toBe(1)
  })

  it('retorna 404 quando não há vínculo', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'DELETE',
      url: '/spotify/link',
      headers: auth(user.id),
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('SPOTIFY_NOT_LINKED')
  })
})

describe('POST /spotify/apply-genres', () => {
  it('acrescenta os gêneros sem apagar os interesses escolhidos à mão', async () => {
    const user = await makeUser()
    await makeUserCategoryPreference(user.id, 'PARTY')
    await makeUserSubcategoryPreference(user.id, 'GENRE_ROCK')
    await makeSpotifyLink(user.id)
    await makeSpotifyTasteSnapshot(user.id, {
      genreKeys: ['GENRE_HOUSE', 'GENRE_TECHNO'],
    })

    const res = await app.inject({
      method: 'POST',
      url: '/spotify/apply-genres',
      headers: auth(user.id),
      body: {},
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().applied).toEqual(['GENRE_HOUSE', 'GENRE_TECHNO'])
    // O manual continua PRIMEIRO: a ordem é o que o ranking do feed considera.
    expect(res.json().interests).toEqual([
      'GENRE_ROCK',
      'GENRE_HOUSE',
      'GENRE_TECHNO',
    ])
  })

  it('limita a importação a 5 gêneros para não enterrar o que é do usuário', async () => {
    const user = await makeUser()
    await makeUserCategoryPreference(user.id, 'PARTY')
    await makeSpotifyLink(user.id)
    await makeSpotifyTasteSnapshot(user.id, {
      genreKeys: [
        'GENRE_HOUSE',
        'GENRE_TECHNO',
        'GENRE_EDM',
        'GENRE_FUNK',
        'GENRE_POP',
        'GENRE_ROCK',
        'GENRE_RAP',
      ],
    })

    const res = await app.inject({
      method: 'POST',
      url: '/spotify/apply-genres',
      headers: auth(user.id),
      body: {},
    })

    expect(res.json().applied).toHaveLength(5)
    expect(res.json().applied).not.toContain('GENRE_RAP')
  })

  it('aplica só o subconjunto que o usuário confirmou', async () => {
    const user = await makeUser()
    await makeUserCategoryPreference(user.id, 'PARTY')
    await makeSpotifyLink(user.id)
    await makeSpotifyTasteSnapshot(user.id, {
      genreKeys: ['GENRE_HOUSE', 'GENRE_TECHNO'],
    })

    const res = await app.inject({
      method: 'POST',
      url: '/spotify/apply-genres',
      headers: auth(user.id),
      body: { genres: ['GENRE_TECHNO'] },
    })

    expect(res.json().applied).toEqual(['GENRE_TECHNO'])
    expect(res.json().interests).toEqual(['GENRE_TECHNO'])
  })

  it('recusa gênero que não está no snapshot do usuário', async () => {
    const user = await makeUser()
    await makeSpotifyLink(user.id)
    await makeSpotifyTasteSnapshot(user.id, { genreKeys: ['GENRE_HOUSE'] })

    const res = await app.inject({
      method: 'POST',
      url: '/spotify/apply-genres',
      headers: auth(user.id),
      body: { genres: ['GENRE_SERTANEJO'] },
    })

    expect(res.statusCode).toBe(422)
  })

  it('adiciona a categoria musical quando o perfil não teria onde casar', async () => {
    const user = await makeUser()
    await makeUserCategoryPreference(user.id, 'SPORTS')
    await makeSpotifyLink(user.id)
    await makeSpotifyTasteSnapshot(user.id, { genreKeys: ['GENRE_HOUSE'] })

    await app.inject({
      method: 'POST',
      url: '/spotify/apply-genres',
      headers: auth(user.id),
      body: {},
    })

    const categories = await testPrisma.userCategoryPreference.findMany({
      where: { userId: user.id },
      select: { category: true },
    })
    expect(categories.map((c) => c.category).sort()).toEqual([
      'MUSIC',
      'SPORTS',
    ])
  })

  it('não mexe nas categorias de quem já tem uma de vida noturna', async () => {
    const user = await makeUser()
    await makeUserCategoryPreference(user.id, 'NIGHTLIFE')
    await makeSpotifyLink(user.id)
    await makeSpotifyTasteSnapshot(user.id, { genreKeys: ['GENRE_HOUSE'] })

    await app.inject({
      method: 'POST',
      url: '/spotify/apply-genres',
      headers: auth(user.id),
      body: {},
    })

    const categories = await testPrisma.userCategoryPreference.findMany({
      where: { userId: user.id },
    })
    expect(categories).toHaveLength(1)
  })

  it('retorna 404 sem snapshot', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'POST',
      url: '/spotify/apply-genres',
      headers: auth(user.id),
      body: {},
    })

    expect(res.statusCode).toBe(404)
  })
})

describe('PATCH /spotify/hidden-artists', () => {
  it('guarda os artistas ocultos escolhidos', async () => {
    const user = await makeUser()
    await makeSpotifyLink(user.id)
    await makeSpotifyTasteSnapshot(user.id)

    const res = await app.inject({
      method: 'PATCH',
      url: '/spotify/hidden-artists',
      headers: auth(user.id),
      body: { hiddenArtistIds: ['0EmeFodog0BfCgMzAIvKQp'] },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().artists[0].hidden).toBe(true)
    const link = await testPrisma.spotifyLink.findUnique({
      where: { userId: user.id },
    })
    expect(link?.hiddenArtistIds).toEqual(['0EmeFodog0BfCgMzAIvKQp'])
  })

  it('recusa id que não está no snapshot', async () => {
    const user = await makeUser()
    await makeSpotifyLink(user.id)
    await makeSpotifyTasteSnapshot(user.id)

    const res = await app.inject({
      method: 'PATCH',
      url: '/spotify/hidden-artists',
      headers: auth(user.id),
      body: { hiddenArtistIds: ['aaaaaaaaaaaaaaaaaaaaaa'] },
    })

    expect(res.statusCode).toBe(422)
  })

  it('rejeita id fora do formato do Spotify', async () => {
    const user = await makeUser()
    await makeSpotifyLink(user.id)

    const res = await app.inject({
      method: 'PATCH',
      url: '/spotify/hidden-artists',
      headers: auth(user.id),
      body: { hiddenArtistIds: ['id-invalido'] },
    })

    expect(res.statusCode).toBe(400)
  })
})

describe('LGPD', () => {
  it('revogar o consentimento apaga o vínculo e o snapshot', async () => {
    const user = await makeUser()
    await makeSpotifyLink(user.id)
    await makeSpotifyTasteSnapshot(user.id)

    const res = await app.inject({
      method: 'DELETE',
      url: '/consent',
      headers: auth(user.id),
    })

    expect(res.statusCode).toBe(200)
    expect(
      await testPrisma.spotifyLink.findUnique({ where: { userId: user.id } }),
    ).toBeNull()
    expect(
      await testPrisma.spotifyTasteSnapshot.findUnique({
        where: { userId: user.id },
      }),
    ).toBeNull()
  })

  it('exporta os dados do Spotify sem entregar o refresh token', async () => {
    const user = await makeUser()
    await makeSpotifyLink(user.id, { spotifyUserId: 'spotify_do_neto' })
    await makeSpotifyTasteSnapshot(user.id)

    const res = await app.inject({
      method: 'GET',
      url: '/consent/export',
      headers: auth(user.id),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().spotify).toMatchObject({
      spotifyUserId: 'spotify_do_neto',
      status: 'ACTIVE',
    })
    expect(res.json().spotify.snapshot).toMatchObject({
      timeRange: 'medium_term',
    })
    expect(res.payload).not.toContain('refreshToken')
    expect(res.payload).not.toContain('refresh_')
  })

  it('exporta spotify null para quem não vinculou', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: '/consent/export',
      headers: auth(user.id),
    })

    expect(res.json().spotify).toBeNull()
  })
})
