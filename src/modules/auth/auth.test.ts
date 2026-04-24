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
})

describe('GET /auth/me', () => {
  it('retorna dados do usuário autenticado', async () => {
    const user = await makeUser()
    const token = app.jwt.sign({ sub: user.id })

    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ id: user.id, email: user.email })
  })

  it('retorna 401 sem token', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/me' })
    expect(res.statusCode).toBe(401)
  })
})
