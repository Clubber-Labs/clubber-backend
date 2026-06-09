import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../test/app'
import { testPrisma } from '../test/prisma'

let app: FastifyInstance

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

beforeAll(async () => {
  app = buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await testPrisma.$disconnect()
})

describe('x-request-id', () => {
  it('ecoa o x-request-id de entrada quando válido', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'trace-abc-1' },
    })

    expect(res.headers['x-request-id']).toBe('trace-abc-1')
  })

  it('gera um novo id quando o header de entrada é inválido', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'id com espaço e caractere inválido!' },
    })

    expect(res.headers['x-request-id']).not.toBe(
      'id com espaço e caractere inválido!',
    )
    expect(res.headers['x-request-id']).toMatch(UUID)
  })

  it('gera um novo id quando o header excede o tamanho máximo', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'a'.repeat(201) },
    })

    expect(res.headers['x-request-id']).toMatch(UUID)
  })

  it('gera um uuid quando não há header', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })

    expect(res.headers['x-request-id']).toMatch(UUID)
  })
})
