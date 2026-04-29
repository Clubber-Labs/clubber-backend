import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import {
  makeAttendance,
  makeComment,
  makeEvent,
  makeFollow,
  makeInvite,
  makeReaction,
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

  it('exibe os próprios eventos mesmo sem seguir ninguém', async () => {
    const viewer = await makeUser()
    const event = await makeEvent(viewer.id, { isPublic: true })

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

  it('retorna eventos onde seguido reagiu', async () => {
    const viewer = await makeUser()
    const followed = await makeUser()
    const author = await makeUser()
    await makeFollow(viewer.id, followed.id)
    const event = await makeEvent(author.id, { isPublic: true })
    await makeReaction(followed.id, event.id)

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

  it('retorna eventos onde seguido comentou', async () => {
    const viewer = await makeUser()
    const followed = await makeUser()
    const author = await makeUser()
    await makeFollow(viewer.id, followed.id)
    const event = await makeEvent(author.id, { isPublic: true })
    await makeComment(followed.id, event.id)

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

  it('retorna 401 sem autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: '/feed' })
    expect(res.statusCode).toBe(401)
  })
})

describe('GET /feed — reason', () => {
  it('reason self_created para evento próprio', async () => {
    const viewer = await makeUser()
    const event = await makeEvent(viewer.id, { isPublic: true })

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    const found = res.json().data.find((e: { id: string }) => e.id === event.id)
    expect(found?.reason).toMatchObject({ kind: 'self_created' })
  })

  it('reason friend_created quando o autor é seguido', async () => {
    const viewer = await makeUser()
    const followed = await makeUser()
    await makeFollow(viewer.id, followed.id)
    const event = await makeEvent(followed.id, { isPublic: true })

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    const found = res.json().data.find((e: { id: string }) => e.id === event.id)
    expect(found?.reason).toMatchObject({
      kind: 'friend_created',
      user: { id: followed.id },
    })
  })

  it('reason friend_attending quando seguido confirmou presença', async () => {
    const viewer = await makeUser()
    const followed = await makeUser()
    const author = await makeUser()
    await makeFollow(viewer.id, followed.id)
    const event = await makeEvent(author.id, { isPublic: true })
    await makeAttendance(followed.id, event.id, 'CONFIRMED')

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    const found = res.json().data.find((e: { id: string }) => e.id === event.id)
    expect(found?.reason).toMatchObject({
      kind: 'friend_attending',
      user: { id: followed.id },
      type: 'CONFIRMED',
    })
  })

  it('reason friend_reacted quando seguido reagiu', async () => {
    const viewer = await makeUser()
    const followed = await makeUser()
    const author = await makeUser()
    await makeFollow(viewer.id, followed.id)
    const event = await makeEvent(author.id, { isPublic: true })
    await makeReaction(followed.id, event.id, 'LIKE')

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    const found = res.json().data.find((e: { id: string }) => e.id === event.id)
    expect(found?.reason).toMatchObject({
      kind: 'friend_reacted',
      user: { id: followed.id },
      type: 'LIKE',
    })
  })

  it('reason friend_commented quando seguido comentou', async () => {
    const viewer = await makeUser()
    const followed = await makeUser()
    const author = await makeUser()
    await makeFollow(viewer.id, followed.id)
    const event = await makeEvent(author.id, { isPublic: true })
    await makeComment(followed.id, event.id, 'Que evento incrível!')

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    const found = res.json().data.find((e: { id: string }) => e.id === event.id)
    expect(found?.reason).toMatchObject({
      kind: 'friend_commented',
      user: { id: followed.id },
      preview: 'Que evento incrível!',
    })
  })

  it('reason self_interaction quando viewer já interagiu', async () => {
    const viewer = await makeUser()
    const author = await makeUser()
    const followed = await makeUser()
    await makeFollow(viewer.id, followed.id)
    const event = await makeEvent(author.id, { isPublic: true })
    await makeAttendance(followed.id, event.id)
    await makeAttendance(viewer.id, event.id, 'INTERESTED')

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    const found = res.json().data.find((e: { id: string }) => e.id === event.id)
    expect(found?.reason).toMatchObject({ kind: 'self_interaction' })
  })
})
