import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import { makeUser } from '../../test/factories'
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

describe('POST /auth/login', () => {
  it('retorna token com credenciais válidas', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      body: { email: user.email, password: 'senha123' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveProperty('token')
  })

  it('retorna 401 com senha incorreta', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      body: { email: user.email, password: 'errada' },
    })

    expect(res.statusCode).toBe(401)
  })

  it('retorna 401 com email inexistente', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      body: { email: 'naoexiste@test.com', password: 'senha123' },
    })

    expect(res.statusCode).toBe(401)
  })

  it('retorna 401 quando o usuário só tem conta social (password=null)', async () => {
    const user = await makeUser({ password: null })

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      body: { email: user.email, password: 'senha123' },
    })

    expect(res.statusCode).toBe(401)
  })
})

describe('POST /auth/login — reativação de conta', () => {
  it('reativa conta DEACTIVATED ao logar', async () => {
    const user = await makeUser({
      accountStatus: 'DEACTIVATED',
      deactivatedAt: new Date(),
    })

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      body: { email: user.email, password: 'senha123' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveProperty('token')

    const reloaded = await testPrisma.user.findUnique({
      where: { id: user.id },
      select: { accountStatus: true, deactivatedAt: true },
    })
    expect(reloaded?.accountStatus).toBe('ACTIVE')
    expect(reloaded?.deactivatedAt).toBeNull()
  })

  it('reativa conta PENDING_DELETION e cancela exclusão agendada', async () => {
    const user = await makeUser({
      accountStatus: 'PENDING_DELETION',
      deactivatedAt: new Date(),
      scheduledDeletionAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    })

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      body: { email: user.email, password: 'senha123' },
    })

    expect(res.statusCode).toBe(200)
    const reloaded = await testPrisma.user.findUnique({
      where: { id: user.id },
      select: { accountStatus: true, scheduledDeletionAt: true },
    })
    expect(reloaded?.accountStatus).toBe('ACTIVE')
    expect(reloaded?.scheduledDeletionAt).toBeNull()
  })

  it('nega login de conta ANONYMIZED', async () => {
    const user = await makeUser({
      accountStatus: 'ANONYMIZED',
      password: null,
      anonymizedAt: new Date(),
    })

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      body: { email: user.email, password: 'senha123' },
    })

    expect(res.statusCode).toBe(401)
  })
})

describe('rate limit em POST /auth/login', () => {
  it('retorna 429 após 10 tentativas no mesmo minuto', async () => {
    const body = { email: 'naoexiste@test.com', password: 'qualquer' }

    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        body,
      })
      expect(res.statusCode).toBe(401)
    }

    const blocked = await app.inject({
      method: 'POST',
      url: '/auth/login',
      body,
    })
    expect(blocked.statusCode).toBe(429)
  })
})

describe('GET /auth/me (removido)', () => {
  it('retorna 404 — rota substituída por GET /users/me', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/me' })
    expect(res.statusCode).toBe(404)
  })
})
