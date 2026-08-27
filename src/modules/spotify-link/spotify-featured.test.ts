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

/** Dono com dois artistas, o primeiro com gêneros crus do Spotify. */
async function donoComArtistas() {
  const user = await makeUser()
  await makeSpotifyLink(user.id)
  await makeSpotifyTasteSnapshot(user.id, {
    artists: [
      {
        id: '0EmeFodog0BfCgMzAIvKQp',
        name: 'RÜFÜS DU SOL',
        imageUrl: 'https://i.scdn.co/rufus.jpg',
        genres: ['melodic house', 'indie dance'],
        rank: 0,
      },
      {
        id: '1uNFoZAHBGtllmzznpCI3s',
        name: 'Charlotte de Witte',
        imageUrl: null,
        genres: ['techno'],
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

describe('GET /users/:id — artista em destaque', () => {
  it('destaca o mais ouvido com os gêneros dele', async () => {
    const dono = await donoComArtistas()
    const visitante = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: `/users/${dono.id}`,
      headers: auth(visitante.id),
    })

    expect(res.json().featuredArtist).toEqual({
      id: '0EmeFodog0BfCgMzAIvKQp',
      name: 'RÜFÜS DU SOL',
      imageUrl: 'https://i.scdn.co/rufus.jpg',
      spotifyUrl: 'https://open.spotify.com/artist/0EmeFodog0BfCgMzAIvKQp',
      genres: ['melodic house', 'indie dance'],
    })
  })

  it('não destaca quando o dono desligou o destaque', async () => {
    const dono = await donoComArtistas()
    await testPrisma.user.update({
      where: { id: dono.id },
      data: { spotifyTopArtistVisible: false },
    })
    const visitante = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: `/users/${dono.id}`,
      headers: auth(visitante.id),
    })

    // A fileira continua: o destaque é layout, não uma segunda privacidade.
    expect(res.json().featuredArtist).toBeNull()
    expect(res.json().topArtists).toHaveLength(2)
  })

  it('não destaca quando a fileira inteira está escondida', async () => {
    const dono = await donoComArtistas()
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

    expect(res.json().featuredArtist).toBeNull()
    expect(res.json().topArtists).toEqual([])
  })

  it('promove o próximo quando o primeiro foi ocultado', async () => {
    const dono = await donoComArtistas()
    await testPrisma.spotifyLink.update({
      where: { userId: dono.id },
      data: { hiddenArtistIds: ['0EmeFodog0BfCgMzAIvKQp'] },
    })
    const visitante = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: `/users/${dono.id}`,
      headers: auth(visitante.id),
    })

    // O destaque nunca pode ser alguém que a fileira esconde.
    expect(res.json().featuredArtist.name).toBe('Charlotte de Witte')
    expect(res.payload).not.toContain('RÜFÜS')
  })

  it('devolve null quando não há vínculo', async () => {
    const dono = await makeUser()
    const visitante = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: `/users/${dono.id}`,
      headers: auth(visitante.id),
    })

    expect(res.json().featuredArtist).toBeNull()
  })

  it('devolve o estado do toggle no próprio perfil', async () => {
    const dono = await donoComArtistas()

    const res = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: auth(dono.id),
    })

    expect(res.json().spotifyTopArtistVisible).toBe(true)
  })

  it('não revela o estado do toggle em perfil de terceiro', async () => {
    const dono = await donoComArtistas()
    const visitante = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: `/users/${dono.id}`,
      headers: auth(visitante.id),
    })

    expect(res.json().spotifyTopArtistVisible).toBeUndefined()
  })

  it('desliga junto na revogação do Art. 18', async () => {
    const dono = await donoComArtistas()

    await app.inject({
      method: 'DELETE',
      url: '/consent',
      headers: auth(dono.id),
    })

    const updated = await testPrisma.user.findUnique({
      where: { id: dono.id },
      select: { spotifyTopArtistVisible: true },
    })
    expect(updated?.spotifyTopArtistVisible).toBe(false)
  })
})
