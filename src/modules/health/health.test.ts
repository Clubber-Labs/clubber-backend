import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import { testPrisma } from '../../test/prisma'
import { isHealthy } from './health.checks'

let app: FastifyInstance

beforeAll(async () => {
  app = buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await testPrisma.$disconnect()
})

describe('GET /health', () => {
  it('retorna 200 com banco e cache UP', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      status: 'ok',
      dependencies: { database: 'up', cache: 'up' },
    })
  })
})

describe('GET /health/live', () => {
  it('retorna 200 sem checar dependências', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/live' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
  })
})

describe('GET /health/ready', () => {
  it('retorna 200 com banco e cache prontos', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/ready' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      status: 'ready',
      dependencies: { database: 'up', cache: 'up' },
    })
  })
})

// Cenários degradados são exercitados via isHealthy (pura): simular banco/cache
// fora exigiria derrubar dependências compartilhadas ou mocks (proibidos), então
// testamos aqui a regra de decisão diretamente.
describe('isHealthy', () => {
  it('está pronto com banco up e cache up', () => {
    expect(isHealthy('up', 'up')).toBe(true)
  })

  it('está pronto com banco up e cache disabled (Redis opcional)', () => {
    expect(isHealthy('up', 'disabled')).toBe(true)
  })

  it('NÃO está pronto com cache down', () => {
    expect(isHealthy('up', 'down')).toBe(false)
  })

  it('NÃO está pronto com banco down', () => {
    expect(isHealthy('down', 'up')).toBe(false)
    expect(isHealthy('down', 'disabled')).toBe(false)
    expect(isHealthy('down', 'down')).toBe(false)
  })
})
