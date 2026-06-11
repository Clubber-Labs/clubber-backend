import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import { makeUser, makeUserCategoryPreference } from '../../test/factories'
import { fakePlaces } from '../../test/fake-places'
import { testPrisma } from '../../test/prisma'

let app: FastifyInstance

function auth(userId: string) {
  return { authorization: `Bearer ${app.jwt.sign({ sub: userId })}` }
}

const POINT = { latitude: -25.4, longitude: -49.3 }

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
    expect(body.remaining).toBe(4) // 5 free - 1
    expect(fakePlaces.calls).toBe(1)
  })

  it('segunda chamada na mesma região vem do cache (não re-chama o Places)', async () => {
    const user = await makeUser()
    await makeUserCategoryPreference(user.id, 'PARTY')

    await suggest(user.id)
    await suggest(user.id)

    // Places chamado uma vez só; a 2ª veio do cache (mas consumiu quota).
    expect(fakePlaces.calls).toBe(1)
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
    expect(fakePlaces.calls).toBe(0)

    const usage = await testPrisma.spotGenerationUsage.findMany({
      where: { userId: user.id },
    })
    expect(usage).toHaveLength(0)
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
