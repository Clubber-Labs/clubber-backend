import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import { makeUser } from '../../test/factories'
import { fakePlaces } from '../../test/fake-places'
import { testPrisma } from '../../test/prisma'

let app: FastifyInstance

function token(app: FastifyInstance, userId: string) {
  return app.jwt.sign({ sub: userId })
}

beforeAll(async () => {
  app = buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await testPrisma.$disconnect()
})

describe('GET /places/autocomplete', () => {
  it('retorna 401 sem autenticação', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/places/autocomplete?q=bar',
    })
    expect(res.statusCode).toBe(401)
  })

  it('retorna 400 com menos de 3 caracteres (guarda de custo)', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: '/places/autocomplete?q=ba',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(400)
    expect(fakePlaces.autocompleteCalls).toBe(0)
  })

  it('retorna sugestões e repassa viés de localização e sessionToken', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: '/places/autocomplete?q=bar do z&lat=-25.4&lng=-49.3&sessionToken=sess-1',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(Array.isArray(body.suggestions)).toBe(true)
    expect(body.suggestions[0]).toMatchObject({
      placeId: expect.any(String),
      name: expect.any(String),
    })
    expect(fakePlaces.autocompleteCalls).toBe(1)
    expect(fakePlaces.lastAutocomplete).toMatchObject({
      input: 'bar do z',
      latitude: -25.4,
      longitude: -49.3,
      sessionToken: 'sess-1',
    })
  })

  it('funciona sem coordenadas (busca sem viés)', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: '/places/autocomplete?q=boteco',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(fakePlaces.lastAutocomplete?.latitude).toBeUndefined()
  })

  it('exige lat e lng juntos', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: '/places/autocomplete?q=boteco&lat=-25.4',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(400)
  })
})

describe('GET /places/:placeId', () => {
  it('retorna 401 sem autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: '/places/p1' })
    expect(res.statusCode).toBe(401)
  })

  it('retorna os detalhes do local e repassa o sessionToken', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: '/places/fake_p1?sessionToken=sess-1',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      placeId: 'fake_p1',
      latitude: expect.any(Number),
      longitude: expect.any(Number),
    })
    expect(fakePlaces.detailsCalls).toBe(1)
    expect(fakePlaces.lastDetails).toEqual({
      placeId: 'fake_p1',
      sessionToken: 'sess-1',
      languageCode: 'pt-BR',
    })
  })

  it('retorna 404 quando o placeId não existe no Places', async () => {
    const user = await makeUser()
    fakePlaces.detailsOverride = () => null

    const res = await app.inject({
      method: 'GET',
      url: '/places/nope',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(404)
  })
})

describe('seletor de local — idioma', () => {
  it('leva o idioma do aparelho para o autocomplete e para os detalhes', async () => {
    const user = await makeUser()
    const headers = {
      authorization: `Bearer ${token(app, user.id)}`,
      'accept-language': 'es',
    }

    await app.inject({
      method: 'GET',
      url: '/places/autocomplete?q=bar&sessionToken=s1',
      headers,
    })
    expect(fakePlaces.lastAutocomplete?.languageCode).toBe('es')

    // As duas metades do mesmo seletor: sugestão e detalhe do escolhido. Se só
    // uma levasse o idioma, o nome viria num idioma e o endereço noutro.
    await app.inject({
      method: 'GET',
      url: '/places/abc123?sessionToken=s1',
      headers,
    })
    expect(fakePlaces.lastDetails?.languageCode).toBe('es')
  })
})
