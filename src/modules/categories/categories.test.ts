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

  it('é público (não exige autenticação)', async () => {
    const res = await app.inject({ method: 'GET', url: '/categories' })
    expect(res.statusCode).toBe(200)
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
