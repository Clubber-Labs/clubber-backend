import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import {
  makeUser,
  makeUserCategoryPreference,
  makeUserSubcategoryPreference,
} from '../../test/factories'
import { fakeEnhancer } from '../../test/fake-enhancer'
import { fakePlaces } from '../../test/fake-places'
import { fakeQueryComposer } from '../../test/fake-query-composer'
import { testPrisma } from '../../test/prisma'

let app: FastifyInstance

function auth(userId: string) {
  return { authorization: `Bearer ${app.jwt.sign({ sub: userId })}` }
}

const POINT = { latitude: -25.4, longitude: -49.3 }

/** Candidato base para roteirizar o override do fakePlaces nos testes de cap. */
function baseCandidate(
  p: { latitude: number; longitude: number },
  placeId: string,
) {
  return {
    placeId,
    name: placeId,
    latitude: p.latitude,
    longitude: p.longitude,
    types: ['bar'],
    address: null,
    rating: null,
    userRatingCount: null,
    priceLevel: null,
    openNow: null,
    distanceMeters: 0,
  }
}

function suggest(userId: string, point = POINT) {
  return app.inject({
    method: 'POST',
    url: '/spots/suggestions',
    headers: auth(userId),
    body: point,
  })
}

beforeAll(async () => {
  app = buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await testPrisma.$disconnect()
})

describe('POST /spots/suggestions', () => {
  it('gera sugestões a partir do perfil via Text Search (200)', async () => {
    const user = await makeUser()
    await makeUserCategoryPreference(user.id, 'PARTY')

    const res = await suggest(user.id)
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.suggestions.length).toBeGreaterThan(0)
    // O perfil vira frase de busca composta pela IA (aqui, o rótulo da categoria).
    expect(fakePlaces.lastText?.textQuery).toBe('Festa')
    // A camada de IA escreveu a copy de cada candidato.
    expect(body.suggestions[0].suggestedTitle).toMatch(/^IA:/)
    expect(body.remaining).toBe(4) // 5 free - 1
    expect(fakePlaces.calls).toBe(1)
  })

  it('a IA ranqueia (reordena) e escreve a copy dos candidatos', async () => {
    const user = await makeUser()
    await makeUserCategoryPreference(user.id, 'PARTY')
    await makeUserCategoryPreference(user.id, 'MUSIC')

    const res = await suggest(user.id)
    const { suggestions } = res.json()

    expect(suggestions).toHaveLength(2)
    // Duas frases (Festa, Música) → 2 candidatos; o fake enhancer inverte a
    // ordem: prova que o service usa o ranqueamento da IA, não a ordem crua.
    expect(suggestions.map((s: { placeId: string }) => s.placeId)).toEqual([
      'fake_text_Música',
      'fake_text_Festa',
    ])
    // E a copy veio da IA em todos.
    expect(
      suggestions.every((s: { suggestedTitle: string }) =>
        s.suggestedTitle.startsWith('IA:'),
      ),
    ).toBe(true)
  })

  it('segunda chamada na mesma região vem do cache (não re-chama Places nem IA)', async () => {
    const user = await makeUser()
    await makeUserCategoryPreference(user.id, 'PARTY')

    await suggest(user.id)
    await suggest(user.id)

    // Resultado enriquecido é cacheado junto: Places, composer E IA rodam uma vez.
    expect(fakePlaces.calls).toBe(1)
    expect(fakeEnhancer.calls).toBe(1)
    expect(fakeQueryComposer.calls).toBe(1)
  })

  it('respeita a quota diária do usuário free (6ª geração → 429)', async () => {
    const user = await makeUser()
    await makeUserCategoryPreference(user.id, 'PARTY')

    for (let i = 0; i < 5; i++) {
      const ok = await suggest(user.id)
      expect(ok.statusCode).toBe(200)
    }
    const blocked = await suggest(user.id)
    expect(blocked.statusCode).toBe(429)
  })

  it('usuário premium tem quota maior (6ª geração ainda passa)', async () => {
    const user = await makeUser({ isPremium: true })
    await makeUserCategoryPreference(user.id, 'PARTY')

    for (let i = 0; i < 6; i++) {
      const res = await suggest(user.id)
      expect(res.statusCode).toBe(200)
    }
  })

  it('sem preferências retorna 400 e não consome quota', async () => {
    const user = await makeUser()

    const res = await suggest(user.id)
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('SPOT_NO_PREFERENCES')

    const usage = await testPrisma.spotGenerationUsage.findMany({
      where: { userId: user.id },
    })
    expect(usage).toHaveLength(0)
  })

  it('categoria sem tipo no Places (TECH) agora busca por texto', async () => {
    const user = await makeUser()
    await makeUserCategoryPreference(user.id, 'TECH')

    const res = await suggest(user.id)

    // Antes dava 400 (sem tipo no Places). Com Text Search, o rótulo da
    // categoria vira a frase de busca — TECH passa a ser pesquisável.
    expect(res.statusCode).toBe(200)
    expect(fakePlaces.lastText?.textQuery).toBe('Tecnologia')
    expect(res.json().suggestions.length).toBeGreaterThan(0)
  })

  it('usa o raio salvo do usuário (spotRadiusKm) como default', async () => {
    const user = await makeUser({ spotRadiusKm: 30 })
    await makeUserCategoryPreference(user.id, 'PARTY')

    await suggest(user.id)

    expect(fakePlaces.lastText?.radiusMeters).toBe(30000)
    expect(fakePlaces.lastText?.limit).toBe(20)
  })

  it('o radiusKm do request sobrescreve o raio salvo', async () => {
    const user = await makeUser({ spotRadiusKm: 10 })
    await makeUserCategoryPreference(user.id, 'PARTY')

    await app.inject({
      method: 'POST',
      url: '/spots/suggestions',
      headers: auth(user.id),
      body: { ...POINT, radiusKm: 40 },
    })

    expect(fakePlaces.lastText?.radiusMeters).toBe(40000)
  })

  it('rejeita radiusKm acima do teto (400)', async () => {
    const user = await makeUser()
    await makeUserCategoryPreference(user.id, 'PARTY')

    const res = await app.inject({
      method: 'POST',
      url: '/spots/suggestions',
      headers: auth(user.id),
      body: { ...POINT, radiusKm: 9999 },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('SPOT_RADIUS_TOO_LARGE')
    expect(fakePlaces.calls).toBe(0)
  })

  it('texto livre usa Text Search e funciona SEM preferências de perfil', async () => {
    const user = await makeUser() // sem nenhuma preferência

    const res = await app.inject({
      method: 'POST',
      url: '/spots/suggestions',
      headers: auth(user.id),
      body: { ...POINT, query: 'bar com música ao vivo' },
    })

    expect(res.statusCode).toBe(200)
    // O texto é a busca; o composer de perfil NÃO é chamado.
    expect(fakePlaces.lastText?.textQuery).toBe('bar com música ao vivo')
    expect(fakeQueryComposer.calls).toBe(0)
    expect(res.json().suggestions.length).toBeGreaterThan(0)
  })

  it('texto livre ignora o perfil (não compõe query do perfil)', async () => {
    const user = await makeUser()
    await makeUserCategoryPreference(user.id, 'PARTY')

    await app.inject({
      method: 'POST',
      url: '/spots/suggestions',
      headers: auth(user.id),
      body: { ...POINT, query: 'exposição de arte' },
    })

    expect(fakePlaces.lastText?.textQuery).toBe('exposição de arte')
    // Prova forte de que o perfil é ignorado: o composer não roda no modo-texto.
    expect(fakeQueryComposer.calls).toBe(0)
  })

  it('descarta candidatos além do teto de distância do alcance', async () => {
    const user = await makeUser()
    await makeUserCategoryPreference(user.id, 'PARTY')
    // raio 5km → teto 10km. Um candidato a ~12km deve cair fora.
    fakePlaces.override = (p) => [
      { ...baseCandidate(p, 'perto'), distanceMeters: 3000 },
      { ...baseCandidate(p, 'longe'), distanceMeters: 12000 },
    ]

    const res = await app.inject({
      method: 'POST',
      url: '/spots/suggestions',
      headers: auth(user.id),
      body: { ...POINT, radiusKm: 5 },
    })

    const ids = res
      .json()
      .suggestions.map((s: { placeId: string }) => s.placeId)
    expect(ids).toContain('perto')
    expect(ids).not.toContain('longe')
  })

  it('limita a quantidade de sugestões devolvidas (cap)', async () => {
    const user = await makeUser()
    await makeUserCategoryPreference(user.id, 'PARTY')
    fakePlaces.override = (p) =>
      Array.from({ length: 12 }, (_, i) => ({
        ...baseCandidate(p, `c${i}`),
        distanceMeters: 100,
      }))

    const res = await app.inject({
      method: 'POST',
      url: '/spots/suggestions',
      headers: auth(user.id),
      body: POINT,
    })

    expect(res.json().suggestions.length).toBeLessThanOrEqual(8)
  })

  it('raio amplo compartilha cache entre pontos próximos', async () => {
    const user = await makeUser()
    await makeUserCategoryPreference(user.id, 'PARTY')
    // ~3km de diferença: dentro da mesma célula grossa do raio amplo → cache hit.
    const near = {
      latitude: POINT.latitude + 0.027,
      longitude: POINT.longitude,
    }

    await app.inject({
      method: 'POST',
      url: '/spots/suggestions',
      headers: auth(user.id),
      body: { ...POINT, radiusKm: 40 },
    })
    await app.inject({
      method: 'POST',
      url: '/spots/suggestions',
      headers: auth(user.id),
      body: { ...near, radiusKm: 40 },
    })

    expect(fakePlaces.calls).toBe(1)
  })

  it('raio estreito não compartilha cache entre os mesmos pontos', async () => {
    const user = await makeUser()
    await makeUserCategoryPreference(user.id, 'PARTY')
    const near = {
      latitude: POINT.latitude + 0.027,
      longitude: POINT.longitude,
    }

    await app.inject({
      method: 'POST',
      url: '/spots/suggestions',
      headers: auth(user.id),
      body: { ...POINT, radiusKm: 4 },
    })
    await app.inject({
      method: 'POST',
      url: '/spots/suggestions',
      headers: auth(user.id),
      body: { ...near, radiusKm: 4 },
    })

    expect(fakePlaces.calls).toBe(2)
  })

  it('subcategoria de venue chega ao composer e vira a busca por texto', async () => {
    const user = await makeUser()
    await makeUserCategoryPreference(user.id, 'GASTRONOMY')
    await makeUserSubcategoryPreference(user.id, 'GASTRONOMY_JAPONESA')
    // Fixa a frase que a IA compõe para isolar o roteamento.
    fakeQueryComposer.nextQueries = ['Japonesa']

    await suggest(user.id)

    // O interesse (rótulo) chega ao composer e a frase composta vira a busca.
    expect(fakeQueryComposer.lastProfile?.interests).toContain('Japonesa')
    expect(fakePlaces.lastText?.textQuery).toBe('Japonesa')
  })

  it('gênero entra como interesse na composição da query', async () => {
    const user = await makeUser()
    await makeUserCategoryPreference(user.id, 'PARTY')
    await makeUserSubcategoryPreference(user.id, 'GENRE_FUNK')

    await suggest(user.id)

    // O gênero (rótulo "Funk") é repassado ao composer como interesse — é a IA
    // que o transforma na busca ("festas de funk"), não um hack hardcoded.
    expect(fakeQueryComposer.lastProfile?.interests).toContain('Funk')
  })

  it('subcategorias diferentes não compartilham cache', async () => {
    const a = await makeUser()
    await makeUserCategoryPreference(a.id, 'GASTRONOMY')
    await makeUserSubcategoryPreference(a.id, 'GASTRONOMY_JAPONESA')
    const b = await makeUser()
    await makeUserCategoryPreference(b.id, 'GASTRONOMY')
    await makeUserSubcategoryPreference(b.id, 'GASTRONOMY_PIZZA')

    await suggest(a.id)
    await suggest(b.id)

    // Chaves de cache distintas (subcat no key) → 2 gerações (composer 2x).
    expect(fakeQueryComposer.calls).toBe(2)
  })

  it('filtro estrutural descarta venue não-social (loja) e mantém o social (bar)', async () => {
    const user = await makeUser()
    await makeUserCategoryPreference(user.id, 'PARTY')
    fakePlaces.override = (p) => [
      { ...baseCandidate(p, 'bar1'), types: ['bar'] },
      { ...baseCandidate(p, 'loja1'), types: ['clothing_store', 'store'] },
    ]

    const res = await suggest(user.id)

    const ids = res
      .json()
      .suggestions.map((s: { placeId: string }) => s.placeId)
    expect(ids).toContain('bar1')
    expect(ids).not.toContain('loja1')
  })

  it('descarta venue adulto pelo nome mesmo tipado como night_club', async () => {
    const user = await makeUser()
    await makeUserCategoryPreference(user.id, 'PARTY')
    // Casa de swing/strip vem do Places como night_club (tipo social) — só o
    // nome denuncia. Filtro de content-safety deve removê-la.
    fakePlaces.override = (p) => [
      {
        ...baseCandidate(p, 'balada-ok'),
        name: 'Balada Boa',
        types: ['night_club'],
      },
      {
        ...baseCandidate(p, 'swing'),
        name: 'Clube de Swing Privê',
        types: ['night_club'],
      },
    ]

    const res = await suggest(user.id)

    const ids = res
      .json()
      .suggestions.map((s: { placeId: string }) => s.placeId)
    expect(ids).toContain('balada-ok')
    expect(ids).not.toContain('swing')
  })

  it('piso: se o filtro social zera tudo, ainda devolve algo e consome quota', async () => {
    const user = await makeUser()
    await makeUserCategoryPreference(user.id, 'PARTY')
    // Só vieram não-sociais: o filtro bypassa para não devolver lista vazia.
    fakePlaces.override = (p) => [
      { ...baseCandidate(p, 'loja1'), types: ['clothing_store', 'store'] },
    ]

    const res = await suggest(user.id)

    expect(res.statusCode).toBe(200)
    expect(res.json().suggestions.length).toBeGreaterThan(0)
    expect(res.json().remaining).toBe(4) // quota foi consumida
  })

  it('composer sem saída cai nos rótulos do perfil e ainda gera', async () => {
    const user = await makeUser()
    await makeUserCategoryPreference(user.id, 'PARTY')
    // IA não devolve frase: o service usa os rótulos de categoria do perfil.
    fakeQueryComposer.nextQueries = []

    const res = await suggest(user.id)

    expect(res.statusCode).toBe(200)
    expect(res.json().suggestions.length).toBeGreaterThan(0)
    expect(fakePlaces.lastText?.textQuery).toBe('Festa')
  })

  it('retorna 401 sem autenticação', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/spots/suggestions',
      body: POINT,
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('PATCH /users/me/spot-prefs', () => {
  it('salva o raio de recomendação de spots do usuário', async () => {
    const user = await makeUser({ spotRadiusKm: 10 })

    const res = await app.inject({
      method: 'PATCH',
      url: '/users/me/spot-prefs',
      headers: auth(user.id),
      body: { spotRadiusKm: 25 },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ spotRadiusKm: 25 })

    const saved = await testPrisma.user.findUnique({ where: { id: user.id } })
    expect(saved?.spotRadiusKm).toBe(25)
  })

  it('rejeita raio acima do teto (400)', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'PATCH',
      url: '/users/me/spot-prefs',
      headers: auth(user.id),
      body: { spotRadiusKm: 9999 },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('SPOT_RADIUS_TOO_LARGE')
  })

  it('retorna 401 sem autenticação', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/users/me/spot-prefs',
      body: { spotRadiusKm: 20 },
    })
    expect(res.statusCode).toBe(401)
  })
})
