import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import {
  makeSpotifyLink,
  makeSpotifyTasteSnapshot,
  makeUser,
} from '../../test/factories'
import { fakeSpotify } from '../../test/fake-spotify'
import { testPrisma } from '../../test/prisma'

let app: FastifyInstance

function auth(userId: string) {
  return { authorization: `Bearer ${app.jwt.sign({ sub: userId })}` }
}

/** Id no formato real do Spotify (base62 de 22), pra passar na validação. */
function spotifyId(seed: string) {
  return seed.padEnd(22, '0')
}

function artist(seed: string, rank = 0) {
  const id = spotifyId(seed)
  return { id, name: `Artista ${seed}`, imageUrl: null, genres: [], rank }
}

/** Dono com uma lista distinta em cada janela. */
async function donoComTresJanelas() {
  const user = await makeUser()
  await makeSpotifyLink(user.id)
  for (const [timeRange, ids] of [
    ['short_term', ['agora1', 'agora2']],
    ['medium_term', ['meio1', 'meio2']],
    ['long_term', ['sempre1']],
  ] as const) {
    await makeSpotifyTasteSnapshot(user.id, {
      timeRange,
      artists: ids.map((id, i) => artist(id, i)),
    })
  }
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

describe('sync das três janelas', () => {
  it('grava uma linha por janela no vínculo', async () => {
    const user = await makeUser()

    await app.inject({
      method: 'POST',
      url: '/spotify/link',
      headers: auth(user.id),
      body: { code: 'code-1', codeVerifier: 'v'.repeat(43) },
    })

    const snapshots = await testPrisma.spotifyTasteSnapshot.findMany({
      where: { userId: user.id },
      orderBy: { timeRange: 'asc' },
    })
    expect(snapshots.map((s) => s.timeRange)).toEqual([
      'long_term',
      'medium_term',
      'short_term',
    ])
    expect(fakeSpotify.topArtistsCalls).toBe(3)
  })

  it('resincronizar substitui as janelas em vez de duplicar', async () => {
    const user = await makeUser()
    const body = { code: 'code-1', codeVerifier: 'v'.repeat(43) }

    await app.inject({
      method: 'POST',
      url: '/spotify/link',
      headers: auth(user.id),
      body,
    })
    await app.inject({
      method: 'POST',
      url: '/spotify/link',
      headers: auth(user.id),
      body,
    })

    expect(
      await testPrisma.spotifyTasteSnapshot.count({
        where: { userId: user.id },
      }),
    ).toBe(3)
  })
})

describe('GET /users/:id — seletor de período', () => {
  it('não devolve as janelas com o seletor desligado', async () => {
    const dono = await donoComTresJanelas()
    const visitante = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: `/users/${dono.id}`,
      headers: auth(visitante.id),
    })

    // Nasce desligado: expor três janelas onde havia uma é opt-in.
    expect(res.json().artistWindows).toBeNull()
    // A fileira segue na janela padrão.
    expect(res.json().topArtists.map((a: { id: string }) => a.id)).toEqual([
      spotifyId('meio1'),
      spotifyId('meio2'),
    ])
  })

  it('devolve as três quando o dono liga o seletor', async () => {
    const dono = await donoComTresJanelas()
    await testPrisma.user.update({
      where: { id: dono.id },
      data: { spotifyWindowVisible: true },
    })
    const visitante = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: `/users/${dono.id}`,
      headers: auth(visitante.id),
    })

    const windows = res.json().artistWindows
    expect(windows.short_term.map((a: { id: string }) => a.id)).toEqual([
      spotifyId('agora1'),
      spotifyId('agora2'),
    ])
    expect(windows.medium_term.map((a: { id: string }) => a.id)).toEqual([
      spotifyId('meio1'),
      spotifyId('meio2'),
    ])
    expect(windows.long_term.map((a: { id: string }) => a.id)).toEqual([
      spotifyId('sempre1'),
    ])
  })

  it('omite a janela sem artistas em vez de mandar lista vazia', async () => {
    const dono = await makeUser()
    await makeSpotifyLink(dono.id)
    // Conta sem histórico longo: o Spotify devolve vazio pro long_term.
    for (const [timeRange, ids] of [
      ['short_term', ['agora1']],
      ['medium_term', ['meio1']],
      ['long_term', []],
    ] as const) {
      await makeSpotifyTasteSnapshot(dono.id, {
        timeRange,
        artists: ids.map((id, i) => artist(id, i)),
      })
    }
    await testPrisma.user.update({
      where: { id: dono.id },
      data: { spotifyWindowVisible: true },
    })
    const visitante = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: `/users/${dono.id}`,
      headers: auth(visitante.id),
    })

    // Aba que não mostra nada parece defeito — melhor não existir.
    expect(Object.keys(res.json().artistWindows)).toEqual([
      'short_term',
      'medium_term',
    ])
  })

  it('não oferece seletor com uma janela só', async () => {
    const dono = await makeUser()
    await makeSpotifyLink(dono.id)
    // É o estado de quem vinculou antes do sync de três janelas existir.
    await makeSpotifyTasteSnapshot(dono.id, {
      timeRange: 'medium_term',
      artists: [artist('meio1')],
    })
    await testPrisma.user.update({
      where: { id: dono.id },
      data: { spotifyWindowVisible: true },
    })
    const visitante = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: `/users/${dono.id}`,
      headers: auth(visitante.id),
    })

    // Sem escolha a fazer, o seletor seria enfeite.
    expect(res.json().artistWindows).toBeNull()
    expect(res.json().topArtists).toHaveLength(1)
  })

  it('respeita o artista ocultado em todas as janelas', async () => {
    const dono = await donoComTresJanelas()
    await testPrisma.user.update({
      where: { id: dono.id },
      data: { spotifyWindowVisible: true },
    })
    await testPrisma.spotifyLink.update({
      where: { userId: dono.id },
      data: { hiddenArtistIds: [spotifyId('agora1')] },
    })
    const visitante = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: `/users/${dono.id}`,
      headers: auth(visitante.id),
    })

    expect(
      res.json().artistWindows.short_term.map((a: { id: string }) => a.id),
    ).toEqual([spotifyId('agora2')])
    expect(res.payload).not.toContain(spotifyId('agora1'))
  })

  it('não devolve janela nenhuma com a fileira escondida', async () => {
    const dono = await donoComTresJanelas()
    await testPrisma.user.update({
      where: { id: dono.id },
      data: { spotifyWindowVisible: true, spotifyArtistsVisible: false },
    })
    const visitante = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: `/users/${dono.id}`,
      headers: auth(visitante.id),
    })

    expect(res.json().artistWindows).toBeNull()
    expect(res.json().topArtists).toEqual([])
  })

  it('não revela o estado do seletor em perfil de terceiro', async () => {
    const dono = await donoComTresJanelas()
    const visitante = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: `/users/${dono.id}`,
      headers: auth(visitante.id),
    })

    expect(res.json().spotifyWindowVisible).toBeUndefined()
  })
})

describe('o resto da feature usa a janela padrão', () => {
  it('a grade de gestão junta os artistas de TODAS as janelas', async () => {
    const dono = await donoComTresJanelas()

    const res = await app.inject({
      method: 'GET',
      url: '/spotify/profile',
      headers: auth(dono.id),
    })

    // Sem isso, esconder alguém que só aparece no "Atualmente" seria impossível.
    expect(
      res
        .json()
        .artists.map((a: { id: string }) => a.id)
        .sort(),
    ).toEqual(
      ['agora1', 'agora2', 'meio1', 'meio2', 'sempre1'].map(spotifyId).sort(),
    )
  })

  it('permite ocultar artista que só existe numa janela não-padrão', async () => {
    const dono = await donoComTresJanelas()

    const res = await app.inject({
      method: 'PATCH',
      url: '/spotify/hidden-artists',
      headers: auth(dono.id),
      body: { hiddenArtistIds: [spotifyId('agora1')] },
    })

    expect(res.statusCode).toBe(200)
  })

  it('cruza sempre a janela padrão no match entre perfis', async () => {
    const dono = await donoComTresJanelas()
    const visitante = await makeUser()
    await makeSpotifyLink(visitante.id)
    // Só coincide com o "Atualmente" do dono — não deve casar.
    await makeSpotifyTasteSnapshot(visitante.id, {
      timeRange: 'medium_term',
      artists: [artist('agora1')],
    })

    const res = await app.inject({
      method: 'GET',
      url: `/users/${dono.id}`,
      headers: auth(visitante.id),
    })

    // Comparar o "agora" de um com o "sempre" de outro não quer dizer nada.
    expect(res.json().artistMatch).toBeNull()
  })
})
