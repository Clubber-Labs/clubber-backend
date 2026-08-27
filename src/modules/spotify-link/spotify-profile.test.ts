import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import {
  makeSpotifyLink,
  makeSpotifyTasteSnapshot,
  makeUser,
} from '../../test/factories'
import { testPrisma } from '../../test/prisma'

let app: FastifyInstance

function auth(userId: string) {
  return { authorization: `Bearer ${app.jwt.sign({ sub: userId })}` }
}

/** Cria um usuário com dois artistas no snapshot. */
async function userComArtistas(
  overrides: Parameters<typeof makeSpotifyLink>[1] = {},
) {
  const user = await makeUser()
  await makeSpotifyLink(user.id, overrides)
  await makeSpotifyTasteSnapshot(user.id, {
    artists: [
      {
        id: '0EmeFodog0BfCgMzAIvKQp',
        name: 'Alok',
        imageUrl: 'https://i.scdn.co/alok.jpg',
        genres: ['brazilian bass'],
        rank: 0,
      },
      {
        id: '1uNFoZAHBGtllmzznpCI3s',
        name: 'Anitta',
        imageUrl: null,
        genres: ['funk carioca'],
        rank: 1,
      },
    ],
  })
  return user
}

beforeAll(async () => {
  app = buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await testPrisma.$disconnect()
})

describe('GET /users/:id — top artistas', () => {
  it('mostra os artistas no perfil público', async () => {
    const dono = await userComArtistas()
    const visitante = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: `/users/${dono.id}`,
      headers: auth(visitante.id),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().topArtists).toEqual([
      {
        id: '0EmeFodog0BfCgMzAIvKQp',
        name: 'Alok',
        imageUrl: 'https://i.scdn.co/alok.jpg',
        spotifyUrl: 'https://open.spotify.com/artist/0EmeFodog0BfCgMzAIvKQp',
      },
      {
        id: '1uNFoZAHBGtllmzznpCI3s',
        name: 'Anitta',
        imageUrl: null,
        spotifyUrl: 'https://open.spotify.com/artist/1uNFoZAHBGtllmzznpCI3s',
      },
    ])
  })

  it('nunca serializa os campos crus do vínculo', async () => {
    const dono = await userComArtistas({
      hiddenArtistIds: ['1uNFoZAHBGtllmzznpCI3s'],
    })
    const visitante = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: `/users/${dono.id}`,
      headers: auth(visitante.id),
    })

    expect(res.payload).not.toContain('hiddenArtistIds')
    expect(res.payload).not.toContain('spotifyLink')
    expect(res.payload).not.toContain('refreshToken')
    // Nem revela pra terceiro que existe um toggle escondendo algo.
    expect(res.payload).not.toContain('spotifyArtistsVisible')
  })

  it('omite o artista ocultado, filtrando no servidor', async () => {
    const dono = await userComArtistas({
      hiddenArtistIds: ['0EmeFodog0BfCgMzAIvKQp'],
    })
    const visitante = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: `/users/${dono.id}`,
      headers: auth(visitante.id),
    })

    const nomes = res.json().topArtists.map((a: { name: string }) => a.name)
    expect(nomes).toEqual(['Anitta'])
    expect(res.payload).not.toContain('Alok')
  })

  it('não mostra nada quando o dono desligou o toggle', async () => {
    const dono = await userComArtistas()
    await testPrisma.user.update({
      where: { id: dono.id },
      data: { spotifyArtistsVisible: false },
    })
    const visitante = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: `/users/${dono.id}`,
      headers: auth(visitante.id),
    })

    expect(res.json().topArtists).toEqual([])
  })

  it('não mostra nada quando o vínculo está revogado', async () => {
    const dono = await userComArtistas({ status: 'REVOKED' })
    const visitante = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: `/users/${dono.id}`,
      headers: auth(visitante.id),
    })

    expect(res.json().topArtists).toEqual([])
  })

  it('devolve lista vazia para quem não vinculou', async () => {
    const dono = await makeUser()
    const visitante = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: `/users/${dono.id}`,
      headers: auth(visitante.id),
    })

    expect(res.json().topArtists).toEqual([])
  })

  it('devolve a fileira inteira, sem corte próprio', async () => {
    const user = await makeUser()
    await makeSpotifyLink(user.id)
    await makeSpotifyTasteSnapshot(user.id, {
      artists: Array.from({ length: 12 }, (_, i) => ({
        id: `${i}`.padStart(22, 'a'),
        name: `Artista ${i}`,
        imageUrl: null,
        genres: [],
        rank: i,
      })),
    })
    const visitante = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: `/users/${user.id}`,
      headers: auth(visitante.id),
    })

    // Quem limita é o snapshot (20); a fileira rola na horizontal. Um teto
    // aqui seria um segundo número pro mesmo dado.
    expect(res.json().topArtists).toHaveLength(12)
  })
})

describe('GET /users/me — preferência de visibilidade', () => {
  it('devolve o estado do toggle para o dono', async () => {
    const user = await userComArtistas()

    const res = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: auth(user.id),
    })

    expect(res.json().spotifyArtistsVisible).toBe(true)
    expect(res.json().topArtists).toHaveLength(2)
  })
})

describe('PUT /users/:id — toggle de visibilidade', () => {
  it('desliga a exibição e some do perfil público', async () => {
    const dono = await userComArtistas()
    const visitante = await makeUser()

    const update = await app.inject({
      method: 'PUT',
      url: `/users/${dono.id}`,
      headers: auth(dono.id),
      body: { spotifyArtistsVisible: false },
    })
    expect(update.statusCode).toBe(200)
    expect(update.json().spotifyArtistsVisible).toBe(false)

    const publico = await app.inject({
      method: 'GET',
      url: `/users/${dono.id}`,
      headers: auth(visitante.id),
    })
    expect(publico.json().topArtists).toEqual([])
  })
})

describe('revogação do Art. 18', () => {
  it('desliga a exibição junto com as demais preferências', async () => {
    const user = await userComArtistas()

    await app.inject({
      method: 'DELETE',
      url: '/consent',
      headers: auth(user.id),
    })

    const updated = await testPrisma.user.findUnique({
      where: { id: user.id },
      select: { spotifyArtistsVisible: true },
    })
    expect(updated?.spotifyArtistsVisible).toBe(false)
  })
})
