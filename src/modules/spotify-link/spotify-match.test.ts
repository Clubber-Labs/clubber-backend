import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import {
  makeSpotifyLink,
  makeSpotifyTasteSnapshot,
  makeUser,
} from '../../test/factories'
import { testPrisma } from '../../test/prisma'
import { matchArtists } from './spotify-match'

let app: FastifyInstance

function auth(userId: string) {
  return { authorization: `Bearer ${app.jwt.sign({ sub: userId })}` }
}

function artist(id: string, name = `Artista ${id}`, rank = 0) {
  return { id, name, imageUrl: null, genres: [], rank }
}

/** Usuário com vínculo ativo e um snapshot com os artistas dados. */
async function userComGosto(ids: string[]) {
  const user = await makeUser()
  await makeSpotifyLink(user.id)
  await makeSpotifyTasteSnapshot(user.id, {
    artists: ids.map((id, i) => artist(id, `Artista ${id}`, i)),
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

describe('matchArtists', () => {
  it('conta a interseção e nomeia até três', () => {
    const mine = [artist('a'), artist('b'), artist('c'), artist('d')]
    const theirs = [artist('b'), artist('c'), artist('d'), artist('e')]

    const result = matchArtists(mine, theirs, { revealNames: true })

    expect(result?.count).toBe(3)
    expect(result?.named.map((a) => a.id)).toEqual(['b', 'c', 'd'])
  })

  it('limita os nomeados a três, mas conta todos', () => {
    const ids = ['a', 'b', 'c', 'd', 'e']
    const artists = ids.map((id) => artist(id))

    const result = matchArtists(artists, artists, { revealNames: true })

    expect(result?.count).toBe(5)
    expect(result?.named).toHaveLength(3)
  })

  it('omite os nomes quando o dono escondeu a fileira', () => {
    const artists = [artist('a'), artist('b')]

    const result = matchArtists(artists, artists, { revealNames: false })

    expect(result?.count).toBe(2)
    expect(result?.named).toEqual([])
  })

  it('usa a ordem do dono do perfil, não a do visitante', () => {
    const mine = [artist('z'), artist('y')]
    const theirs = [artist('y'), artist('z')]

    const result = matchArtists(mine, theirs, { revealNames: true })

    expect(result?.named.map((a) => a.id)).toEqual(['y', 'z'])
  })

  it('devolve null sem interseção', () => {
    expect(
      matchArtists([artist('a')], [artist('b')], { revealNames: true }),
    ).toBeNull()
  })

  it('devolve null quando um dos dois não tem snapshot', () => {
    expect(matchArtists([], [artist('a')], { revealNames: true })).toBeNull()
    expect(matchArtists([artist('a')], [], { revealNames: true })).toBeNull()
  })

  it('devolve null para Json inválido em vez de quebrar', () => {
    expect(
      matchArtists('lixo', [artist('a')], { revealNames: true }),
    ).toBeNull()
  })
})

describe('GET /users/:id — artistas em comum', () => {
  it('mostra os nomes quando o dono exibe a fileira', async () => {
    const dono = await userComGosto(['alok', 'anitta', 'bk'])
    const visitante = await userComGosto(['alok', 'anitta', 'outro'])

    const res = await app.inject({
      method: 'GET',
      url: `/users/${dono.id}`,
      headers: auth(visitante.id),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().artistMatch).toMatchObject({ count: 2 })
    expect(
      res.json().artistMatch.named.map((a: { id: string }) => a.id),
    ).toEqual(['alok', 'anitta'])
  })

  it('devolve só a contagem quando o dono escondeu a fileira', async () => {
    const dono = await userComGosto(['alok', 'anitta', 'bk'])
    await testPrisma.user.update({
      where: { id: dono.id },
      data: { spotifyArtistsVisible: false },
    })
    const visitante = await userComGosto(['alok', 'anitta', 'bk'])

    const res = await app.inject({
      method: 'GET',
      url: `/users/${dono.id}`,
      headers: auth(visitante.id),
    })

    // A contagem sobrevive, os nomes não — e nada do artista vaza no payload.
    expect(res.json().artistMatch).toEqual({ count: 3, named: [] })
    expect(res.payload).not.toContain('alok')
    expect(res.json().topArtists).toEqual([])
  })

  it('não calcula match no próprio perfil', async () => {
    const user = await userComGosto(['alok'])

    const res = await app.inject({
      method: 'GET',
      url: `/users/${user.id}`,
      headers: auth(user.id),
    })

    expect(res.json().artistMatch).toBeNull()
  })

  it('devolve null quando o visitante não vinculou', async () => {
    const dono = await userComGosto(['alok'])
    const visitante = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: `/users/${dono.id}`,
      headers: auth(visitante.id),
    })

    expect(res.json().artistMatch).toBeNull()
  })

  it('devolve null quando o vínculo do dono foi revogado', async () => {
    const dono = await userComGosto(['alok'])
    await testPrisma.spotifyLink.update({
      where: { userId: dono.id },
      data: { status: 'REVOKED' },
    })
    const visitante = await userComGosto(['alok'])

    const res = await app.inject({
      method: 'GET',
      url: `/users/${dono.id}`,
      headers: auth(visitante.id),
    })

    expect(res.json().artistMatch).toBeNull()
  })

  it('devolve null para visitante deslogado', async () => {
    const dono = await userComGosto(['alok'])

    const res = await app.inject({ method: 'GET', url: `/users/${dono.id}` })

    expect(res.statusCode).toBe(200)
    expect(res.json().artistMatch).toBeNull()
  })
})
