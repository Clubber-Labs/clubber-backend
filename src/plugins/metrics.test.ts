import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../test/app'
import { testPrisma } from '../test/prisma'
import { isAuthorized } from './metrics'

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

  it('expõe as métricas de pool de conexão do Prisma', async () => {
    await app.inject({ method: 'GET', url: '/health' })

    const res = await app.inject({ method: 'GET', url: '/metrics' })

    // prisma.$metrics.prometheus() expõe o estado do pool — saturação é o
    // sinal de pressão no banco sob escala horizontal.
    expect(res.body).toContain('prisma_pool_connections_open')
  })

  it('não contabiliza o próprio /metrics', async () => {
    await app.inject({ method: 'GET', url: '/metrics' })

    const res = await app.inject({ method: 'GET', url: '/metrics' })

    expect(res.body).not.toMatch(/route="\/metrics"/)
  })
})

// O env é singleton parseado na importação, então o path de auth do /metrics não
// é variável por teste de integração. isAuthorized é pura — testamos ela direto.
describe('isAuthorized', () => {
  it('rejeita requisição sem header', () => {
    expect(isAuthorized(undefined, 'tok123')).toBe(false)
  })

  it('rejeita header sem o prefixo Bearer', () => {
    expect(isAuthorized('tok123', 'tok123')).toBe(false)
  })

  it('rejeita token de tamanho diferente', () => {
    expect(isAuthorized('Bearer errado', 'tok123')).toBe(false)
  })

  it('rejeita token de mesmo tamanho porém incorreto (exercita timingSafeEqual)', () => {
    expect(isAuthorized('Bearer tok124', 'tok123')).toBe(false)
  })

  it('aceita o token correto', () => {
    expect(isAuthorized('Bearer tok123', 'tok123')).toBe(true)
  })
})
