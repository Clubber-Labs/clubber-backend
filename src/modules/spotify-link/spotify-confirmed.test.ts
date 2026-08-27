import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import {
  makeSpotifyLink,
  makeSpotifyTasteSnapshot,
  makeUser,
  makeUserSubcategoryPreference,
} from '../../test/factories'
import { testPrisma } from '../../test/prisma'

let app: FastifyInstance

function auth(userId: string) {
  return { authorization: `Bearer ${app.jwt.sign({ sub: userId })}` }
}

/** Id no formato real do Spotify (base62 de 22), pra passar na validação. */
function artist(seed: string, genres: string[], rank = 0) {
  return {
    id: seed.padEnd(22, '0'),
    name: `Artista ${seed}`,
    imageUrl: null,
    genres,
    rank,
  }
}

/**
 * Os artistas é que dirigem estes testes, nunca o `genreKeys` gravado: a marca
 * sai do de-para sobre a lista já filtrada, e passar a coluna crua esconderia
 * justamente a diferença entre as duas bases.
 */
const TECHNO = artist('techno1', ['techno'], 0)
const HOUSE = artist('house1', ['brazilian bass'], 1)

/**
 * Perfil com quatro interesses declarados, dos quais o Spotify sustenta dois.
 * Os outros dois existem pra provar que a marca é interseção, não "tem vínculo
 * então marca tudo".
 */
async function donoComInteresses(artists = [TECHNO, HOUSE]) {
  const user = await makeUser()
  for (const key of [
    'GENRE_TECHNO',
    'GENRE_HOUSE',
    'GENRE_SERTANEJO',
    'GENRE_ROCK',
  ]) {
    await makeUserSubcategoryPreference(user.id, key)
  }
  await makeSpotifyLink(user.id)
  await makeSpotifyTasteSnapshot(user.id, { artists })
  return user
}

async function confirmados(viewerId: string, targetId: string) {
  const res = await app.inject({
    method: 'GET',
    url: `/users/${targetId}`,
    headers: auth(viewerId),
  })
  return res.json().spotifyConfirmedInterests
}

beforeAll(async () => {
  app = buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await testPrisma.$disconnect()
})

describe('GET /users/:id — interesses que o Spotify confirma', () => {
  it('marca só os interesses que o gosto sustenta', async () => {
    const dono = await donoComInteresses()
    const visitante = await makeUser()

    expect(await confirmados(visitante.id, dono.id)).toEqual([
      'GENRE_TECHNO',
      'GENRE_HOUSE',
    ])
  })

  it('ignora o gênero que o Spotify tem mas o perfil não declara', async () => {
    const dono = await donoComInteresses([
      TECHNO,
      artist('psy1', ['psytrance'], 1),
    ])
    const visitante = await makeUser()

    // A marca qualifica o que já está no perfil; não é um segundo canal pra
    // publicar gosto que a pessoa não escolheu declarar.
    expect(await confirmados(visitante.id, dono.id)).toEqual(['GENRE_TECHNO'])
  })

  it('segue a ordem do perfil, não a da afinidade do Spotify', async () => {
    const dono = await donoComInteresses([
      artist('house1', ['brazilian bass'], 0),
      artist('techno1', ['techno'], 1),
    ])
    const visitante = await makeUser()

    // O cliente marca os chips na ordem em que os desenha; devolver na ordem
    // do perfil evita ele ter que reordenar pra casar.
    expect(await confirmados(visitante.id, dono.id)).toEqual([
      'GENRE_TECHNO',
      'GENRE_HOUSE',
    ])
  })

  it('não marca nada com a fileira de artistas escondida', async () => {
    const dono = await donoComInteresses()
    await testPrisma.user.update({
      where: { id: dono.id },
      data: { spotifyArtistsVisible: false },
    })
    const visitante = await makeUser()

    // Quem escondeu a música escondeu o que dela se deduz: a marca revelaria
    // tanto o vínculo quanto os gêneros que ele ouve.
    expect(await confirmados(visitante.id, dono.id)).toEqual([])
  })

  it('apaga a marca do gênero que só o artista oculto sustentava', async () => {
    const dono = await donoComInteresses()
    await testPrisma.spotifyLink.update({
      where: { userId: dono.id },
      data: { hiddenArtistIds: [HOUSE.id] },
    })
    const visitante = await makeUser()

    // Ocultar artista é curadoria sobre a evidência de escuta, e o selo É
    // evidência de escuta: deixá-lo aceso contaria justamente o que a pessoa
    // acabou de tirar da fileira. Mesma regra que o match já segue.
    expect(await confirmados(visitante.id, dono.id)).toEqual(['GENRE_TECHNO'])
  })

  it('mantém a marca quando outro artista visível sustenta o mesmo gênero', async () => {
    const dono = await donoComInteresses([
      TECHNO,
      HOUSE,
      artist('house2', ['house'], 2),
    ])
    await testPrisma.spotifyLink.update({
      where: { userId: dono.id },
      data: { hiddenArtistIds: [HOUSE.id] },
    })
    const visitante = await makeUser()

    // A marca segue a evidência, não o ato de ocultar: sobrando quem sustente
    // o gênero, ele continua confirmado.
    expect(await confirmados(visitante.id, dono.id)).toEqual([
      'GENRE_TECHNO',
      'GENRE_HOUSE',
    ])
  })

  it('não marca nada com o vínculo revogado', async () => {
    const dono = await donoComInteresses()
    await testPrisma.spotifyLink.update({
      where: { userId: dono.id },
      data: { status: 'REVOKED' },
    })
    const visitante = await makeUser()

    expect(await confirmados(visitante.id, dono.id)).toEqual([])
  })

  it('devolve lista vazia pra quem nunca vinculou', async () => {
    const dono = await makeUser()
    await makeUserSubcategoryPreference(dono.id, 'GENRE_TECHNO')
    const visitante = await makeUser()

    expect(await confirmados(visitante.id, dono.id)).toEqual([])
  })

  it('mostra a marca também no perfil próprio', async () => {
    const dono = await donoComInteresses()

    // É o dono quem mais precisa ver: a marca é o retorno de ter vinculado.
    expect(await confirmados(dono.id, dono.id)).toEqual([
      'GENRE_TECHNO',
      'GENRE_HOUSE',
    ])
  })

  it('cruza a janela padrão, igual ao resto da feature', async () => {
    const dono = await makeUser()
    await makeUserSubcategoryPreference(dono.id, 'GENRE_TECHNO')
    await makeSpotifyLink(dono.id)
    await makeSpotifyTasteSnapshot(dono.id, {
      timeRange: 'medium_term',
      artists: [],
    })
    await makeSpotifyTasteSnapshot(dono.id, {
      timeRange: 'short_term',
      artists: [TECHNO],
    })
    const visitante = await makeUser()

    // Trocar de janela no seletor não pode mudar a marca: ela qualifica o
    // perfil, que é um só, e não a fileira que está à vista.
    expect(await confirmados(visitante.id, dono.id)).toEqual([])
  })
})
