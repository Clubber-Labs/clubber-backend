import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../test/app'
import { testPrisma } from '../test/prisma'

let app: FastifyInstance

beforeAll(async () => {
  app = buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await testPrisma.$disconnect()
})

describe('GET /metrics', () => {
  it('expõe métricas Prometheus após tráfego', async () => {
    await app.inject({ method: 'GET', url: '/health' })

    const res = await app.inject({ method: 'GET', url: '/metrics' })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/plain')

    const body = res.body
    expect(body).toContain('http_requests_total')
    expect(body).toContain('http_request_duration_seconds_bucket')
    // métrica default de processo
    expect(body).toContain('process_cpu_seconds_total')
    // a rota /health foi contabilizada com o padrão de rota
    expect(body).toMatch(/http_requests_total\{[^}]*route="\/health"/)
  })

  it('não contabiliza o próprio /metrics', async () => {
    await app.inject({ method: 'GET', url: '/metrics' })

    const res = await app.inject({ method: 'GET', url: '/metrics' })

    expect(res.body).not.toMatch(/route="\/metrics"/)
  })
})
