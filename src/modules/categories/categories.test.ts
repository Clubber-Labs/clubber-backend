import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SELECTABLE_CATEGORIES } from '../../lib/event-categories'
import { buildApp } from '../../test/app'
import { testPrisma } from '../../test/prisma'

let app: FastifyInstance

beforeAll(async () => {
  app = buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await testPrisma.$disconnect()
})

describe('GET /categories', () => {
  it('lista as categorias selecionáveis com rótulo pt-BR por default', async () => {
    const res = await app.inject({ method: 'GET', url: '/categories' })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.locale).toBe('pt-BR')
    expect(body.data).toHaveLength(SELECTABLE_CATEGORIES.length)
    const gastronomy = body.data.find(
      (c: { value: string }) => c.value === 'GASTRONOMY',
    )
    expect(gastronomy).toMatchObject({
      value: 'GASTRONOMY',
      label: 'Gastronomia',
    })
    // Duas camadas: a categoria leva subcategorias aninhadas e rotuladas.
    expect(gastronomy.subcategories).toEqual(
      expect.arrayContaining([
        { value: 'GASTRONOMY_JAPONESA', label: 'Japonesa' },
      ]),
    )
  })

  it('não oferece categorias descontinuadas (RELIGION)', async () => {
    const res = await app.inject({ method: 'GET', url: '/categories' })
    const values = res.json().data.map((c: { value: string }) => c.value)
    expect(values).not.toContain('RELIGION')
  })

  it('expõe os gêneros musicais como dimensão à parte, com appliesTo', async () => {
    const res = await app.inject({ method: 'GET', url: '/categories' })
    const { genres } = res.json()
    const funk = genres.find((g: { value: string }) => g.value === 'GENRE_FUNK')
    // appliesTo permite o gating dinâmico no cliente (gênero é transversal à
    // vida noturna — PARTY/MUSIC/NIGHTLIFE — não a uma categoria só).
    expect(funk).toMatchObject({ value: 'GENRE_FUNK', label: 'Funk' })
    expect(funk.appliesTo).toEqual(
      expect.arrayContaining(['PARTY', 'MUSIC', 'NIGHTLIFE']),
    )
  })

  it('é público (não exige autenticação)', async () => {
    const res = await app.inject({ method: 'GET', url: '/categories' })
    expect(res.statusCode).toBe(200)
  })

  it('traduz categorias, subcategorias e gêneros com Accept-Language: en', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/categories',
      headers: { 'accept-language': 'en' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.locale).toBe('en')
    const gastronomy = body.data.find(
      (c: { value: string }) => c.value === 'GASTRONOMY',
    )
    expect(gastronomy).toMatchObject({
      value: 'GASTRONOMY',
      label: 'Food',
    })
    expect(gastronomy.subcategories).toEqual(
      expect.arrayContaining([
        { value: 'GASTRONOMY_JAPONESA', label: 'Sushi & Japanese' },
      ]),
    )
    const funk = body.genres.find(
      (g: { value: string }) => g.value === 'GENRE_FUNK',
    )
    expect(funk).toMatchObject({ value: 'GENRE_FUNK', label: 'Baile funk' })
  })

  it('negocia es por q-value a partir de variante regional', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/categories',
      headers: { 'accept-language': 'es-AR,es;q=0.9,en;q=0.8' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.locale).toBe('es')
    expect(
      body.data.find((c: { value: string }) => c.value === 'GASTRONOMY'),
    ).toMatchObject({ label: 'Comida' })
  })

  it('marca a resposta com Vary: Accept-Language para caches/CDNs', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/categories',
      headers: { 'accept-language': 'en' },
    })

    expect(res.headers.vary).toContain('Accept-Language')
  })

  it('idioma sem dicionário cai no inglês; sem header, pt-BR', async () => {
    const fr = await app.inject({
      method: 'GET',
      url: '/categories',
      headers: { 'accept-language': 'fr-FR,fr;q=0.9' },
    })
    expect(fr.statusCode).toBe(200)
    // fr não tem dicionário → fallback internacional (en), não pt-BR
    expect(fr.json().locale).toBe('en')

    const none = await app.inject({ method: 'GET', url: '/categories' })
    expect(none.json().locale).toBe('pt-BR')
  })

  it('resolve idioma base pt para pt-BR', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/categories',
      headers: { 'accept-language': 'pt' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().locale).toBe('pt-BR')
  })
})
