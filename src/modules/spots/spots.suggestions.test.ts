import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import { makeUser, makeUserCategoryPreference } from '../../test/factories'
import { fakeEnhancer } from '../../test/fake-enhancer'
import { fakePlaces } from '../../test/fake-places'
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
    category: 'PARTY' as const,
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
  it('gera sugestões filtradas pelas preferências (200)', async () => {
    const user = await makeUser()
    await makeUserCategoryPreference(user.id, 'PARTY')

    const res = await suggest(user.id)
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.suggestions.length).toBeGreaterThan(0)
    expect(
      body.suggestions.every(
        (s: { category: string }) => s.category === 'PARTY',
      ),
    ).toBe(true)
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
    // O fake enhancer inverte a ordem do Places: prova que o service usa o
    // ranqueamento da IA, não a ordem crua do Places.
    expect(suggestions[0].category).toBe('PARTY')
    expect(suggestions[1].category).toBe('MUSIC')
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

    // Resultado enriquecido é cacheado junto: Places E IA rodam uma vez só.
    expect(fakePlaces.calls).toBe(1)
    expect(fakeEnhancer.calls).toBe(1)
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

  it('preferência sem mapeamento no Places retorna 400 sem consumir quota', async () => {
    const user = await makeUser()
    await makeUserCategoryPreference(user.id, 'TECH') // sem tipo no Places

    const res = await suggest(user.id)
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('SPOT_PREFERENCES_NO_PLACES')
    expect(fakePlaces.calls).toBe(0)

    const usage = await testPrisma.spotGenerationUsage.findMany({
      where: { userId: user.id },
    })
    expect(usage).toHaveLength(0)
  })

  it('usa o raio salvo do usuário (spotRadiusKm) como default', async () => {
    const user = await makeUser({ spotRadiusKm: 30 })
    await makeUserCategoryPreference(user.id, 'PARTY')

    await suggest(user.id)

    expect(fakePlaces.lastNearby?.radiusMeters).toBe(30000)
    expect(fakePlaces.lastNearby?.limit).toBe(20)
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

    expect(fakePlaces.lastNearby?.radiusMeters).toBe(40000)
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
    // Roteou para a busca por texto, não a por categoria.
    expect(fakePlaces.lastText?.textQuery).toBe('bar com música ao vivo')
    expect(fakePlaces.lastNearby).toBeNull()
    expect(res.json().suggestions.length).toBeGreaterThan(0)
  })

  it('texto livre ignora o perfil (não chama a busca por categoria)', async () => {
    const user = await makeUser()
    await makeUserCategoryPreference(user.id, 'PARTY')

    await app.inject({
      method: 'POST',
      url: '/spots/suggestions',
      headers: auth(user.id),
      body: { ...POINT, query: 'exposição de arte' },
    })

    expect(fakePlaces.lastText?.textQuery).toBe('exposição de arte')
    expect(fakePlaces.lastNearby).toBeNull()
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
