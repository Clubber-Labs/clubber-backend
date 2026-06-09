import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EVENT_CATEGORIES } from '../../lib/event-categories'
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
  it('lista todas as categorias com rótulo pt-BR por default', async () => {
    const res = await app.inject({ method: 'GET', url: '/categories' })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.locale).toBe('pt-BR')
    expect(body.data).toHaveLength(EVENT_CATEGORIES.length)
    expect(body.data).toEqual(
      expect.arrayContaining([{ value: 'MUSIC', label: 'Música' }]),
    )
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
