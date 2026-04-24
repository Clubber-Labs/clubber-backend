import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import {
  makeAttendance,
  makeEvent,
  makeFollow,
  makeInvite,
  makeUser,
} from '../../test/factories'
import { testPrisma } from '../../test/prisma'

let app: FastifyInstance

function token(app: FastifyInstance, userId: string) {
  return app.jwt.sign({ sub: userId })
}

beforeAll(async () => {
  app = buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await testPrisma.$disconnect()
})

describe('GET /feed', () => {
  it('retorna eventos de quem o usuário segue', async () => {
    const viewer = await makeUser()
    const followed = await makeUser()
    await makeFollow(viewer.id, followed.id)
    await makeEvent(followed.id, { isPublic: true })

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.length).toBeGreaterThan(0)
  })

  it('retorna eventos onde seguidos têm presença', async () => {
    const viewer = await makeUser()
    const followed = await makeUser()
    const author = await makeUser()
    await makeFollow(viewer.id, followed.id)
    const event = await makeEvent(author.id, { isPublic: true })
    await makeAttendance(followed.id, event.id)

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.some((e: { id: string }) => e.id === event.id)).toBe(
      true,
    )
  })

  it('não exibe eventos privados sem acesso do viewer', async () => {
    const viewer = await makeUser()
    const followed = await makeUser()
    await makeFollow(viewer.id, followed.id)
    await makeEvent(followed.id, { isPublic: false })

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.statusCode).toBe(200)
    // Nenhum evento privado de followed deve aparecer (viewer não foi convidado)
    const hasPrivate = res
      .json()
      .data.some((e: { isPublic: boolean }) => !e.isPublic)
    expect(hasPrivate).toBe(false)
  })

  it('exibe evento privado se viewer for convidado', async () => {
    const viewer = await makeUser()
    const followed = await makeUser()
    await makeFollow(viewer.id, followed.id)
    const event = await makeEvent(followed.id, { isPublic: false })
    await makeInvite(event.id, followed.id, viewer.id)

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.some((e: { id: string }) => e.id === event.id)).toBe(
      true,
    )
  })

  it('retorna lista vazia se não segue ninguém', async () => {
    const viewer = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ data: [], nextCursor: null })
  })

  it('retorna 401 sem autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: '/feed' })
    expect(res.statusCode).toBe(401)
  })
})
