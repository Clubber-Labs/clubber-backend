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

  it('não oferece categorias descontinuadas pela curadoria jovem', async () => {
    const res = await app.inject({ method: 'GET', url: '/categories' })
    const values = res.json().data.map((c: { value: string }) => c.value)
    for (const deprecated of [
      'RELIGION',
      'TECH',
      'BUSINESS',
      'EDUCATION',
      'FAMILY',
      'VOLUNTEERING',
      'FASHION',
      'HEALTH_WELLNESS',
    ]) {
      expect(values).not.toContain(deprecated)
    }
  })

  it('oferece as categorias novas da curadoria (BRECHO, FESTIVAL)', async () => {
    const res = await app.inject({ method: 'GET', url: '/categories' })
    const byValue = new Map(
      res
        .json()
        .data.map((c: { value: string; label: string }) => [c.value, c]),
    )
    expect(byValue.get('BRECHO')).toMatchObject({ label: 'Brechó' })
    // Festival é evento, não venue: categoria sem subcategorias.
    expect(byValue.get('FESTIVAL')).toMatchObject({
      label: 'Festivais',
      subcategories: [],
    })
  })

  it('balada é subcategoria de vida noturna', async () => {
    const res = await app.inject({ method: 'GET', url: '/categories' })
    const nightlife = res
      .json()
      .data.find((c: { value: string }) => c.value === 'NIGHTLIFE')
    expect(nightlife.subcategories).toEqual(
      expect.arrayContaining([{ value: 'NIGHTLIFE_BALADA', label: 'Balada' }]),
    )
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
    // Curadoria: festival é rolê musical — gênero aplica lá também.
    expect(funk.appliesTo).toContain('FESTIVAL')
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

  it('respeita Accept-Language com fallback para pt-BR', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/categories',
      headers: { 'accept-language': 'fr-FR,fr;q=0.9' },
    })

    expect(res.statusCode).toBe(200)
    // fr não tem dicionário ainda → fallback pt-BR
    expect(res.json().locale).toBe('pt-BR')
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
