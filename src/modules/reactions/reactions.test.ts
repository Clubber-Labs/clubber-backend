import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import { makeAttendance, makeEvent, makeUser } from '../../test/factories'
import { testPrisma } from '../../test/prisma'

let app: FastifyInstance

function token(app: FastifyInstance, userId: string) {
  return app.jwt.sign({ sub: userId })
}

async function makePost(app: FastifyInstance, userId: string, eventId: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/events/${eventId}/posts`,
    headers: { authorization: `Bearer ${token(app, userId)}` },
    body: { content: 'Post base' },
  })
  return res.json()
}

beforeAll(async () => {
  app = buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await testPrisma.$disconnect()
})

describe('POST /events/:eventId/reactions', () => {
  it('adiciona reação em evento', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/reactions`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { type: 'LIKE' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ type: 'LIKE', userId: user.id })
  })

  it('atualiza reação existente (troca tipo)', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)

    await app.inject({
      method: 'POST',
      url: `/events/${event.id}/reactions`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { type: 'LIKE' },
    })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/reactions`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { type: 'LOVE' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ type: 'LOVE' })

    const count = await testPrisma.reaction.count({
      where: { userId: user.id, eventId: event.id },
    })
    expect(count).toBe(1)
  })

  it('retorna 403 em evento privado sem acesso', async () => {
    const author = await makeUser()
    const other = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/reactions`,
      headers: { authorization: `Bearer ${token(app, other.id)}` },
      body: { type: 'LIKE' },
    })

    expect(res.statusCode).toBe(403)
  })
})

describe('DELETE /events/:eventId/reactions', () => {
  it('remove reação do evento', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)

    await app.inject({
      method: 'POST',
      url: `/events/${event.id}/reactions`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { type: 'LIKE' },
    })

    const res = await app.inject({
      method: 'DELETE',
      url: `/events/${event.id}/reactions`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(204)
  })

  it('retorna 404 sem reação prévia', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)

    const res = await app.inject({
      method: 'DELETE',
      url: `/events/${event.id}/reactions`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(404)
  })
})

describe('POST /posts/:postId/reactions', () => {
  it('adiciona reação em post', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)
    await makeAttendance(user.id, event.id, 'CONFIRMED')
    const post = await makePost(app, user.id, event.id)

    const res = await app.inject({
      method: 'POST',
      url: `/posts/${post.id}/reactions`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { type: 'HAHA' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ type: 'HAHA', postId: post.id })
  })
})

describe('DELETE /posts/:postId/reactions', () => {
  it('remove reação do post', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)
    await makeAttendance(user.id, event.id, 'CONFIRMED')
    const post = await makePost(app, user.id, event.id)

    await app.inject({
      method: 'POST',
      url: `/posts/${post.id}/reactions`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { type: 'LIKE' },
    })

    const res = await app.inject({
      method: 'DELETE',
      url: `/posts/${post.id}/reactions`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(204)
  })
})
