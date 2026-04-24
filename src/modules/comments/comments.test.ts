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

describe('POST /events/:eventId/comments', () => {
  it('comenta em evento', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/comments`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { content: 'Que evento!' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({
      content: 'Que evento!',
      eventId: event.id,
    })
  })

  it('retorna 403 em evento privado sem acesso', async () => {
    const author = await makeUser()
    const other = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/comments`,
      headers: { authorization: `Bearer ${token(app, other.id)}` },
      body: { content: 'Comentário proibido' },
    })

    expect(res.statusCode).toBe(403)
  })
})

describe('GET /events/:eventId/comments', () => {
  it('lista comentários com paginação', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)

    await app.inject({
      method: 'POST',
      url: `/events/${event.id}/comments`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { content: 'Comentário 1' },
    })

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}/comments`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      data: expect.any(Array),
      nextCursor: null,
    })
  })
})

describe('DELETE /events/:eventId/comments/:commentId', () => {
  it('autor deleta o próprio comentário', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)

    const created = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/comments`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { content: 'Para deletar' },
    })
    const comment = created.json()

    const res = await app.inject({
      method: 'DELETE',
      url: `/events/${event.id}/comments/${comment.id}`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(204)
  })

  it('retorna 403 se não for o autor', async () => {
    const author = await makeUser()
    const other = await makeUser()
    const event = await makeEvent(author.id)

    const created = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/comments`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: { content: 'Comentário do autor' },
    })
    const comment = created.json()

    const res = await app.inject({
      method: 'DELETE',
      url: `/events/${event.id}/comments/${comment.id}`,
      headers: { authorization: `Bearer ${token(app, other.id)}` },
    })

    expect(res.statusCode).toBe(403)
  })

  it('retorna 404 com eventId errado', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)
    const otherEvent = await makeEvent(user.id)

    const created = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/comments`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { content: 'Comentário' },
    })
    const comment = created.json()

    const res = await app.inject({
      method: 'DELETE',
      url: `/events/${otherEvent.id}/comments/${comment.id}`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(404)
  })
})

describe('POST /posts/:postId/comments', () => {
  it('comenta em post', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)
    await makeAttendance(user.id, event.id, 'CONFIRMED')
    const post = await makePost(app, user.id, event.id)

    const res = await app.inject({
      method: 'POST',
      url: `/posts/${post.id}/comments`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { content: 'Comentário no post' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({
      content: 'Comentário no post',
      postId: post.id,
    })
  })
})

describe('DELETE /posts/:postId/comments/:commentId', () => {
  it('autor deleta comentário no post', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)
    await makeAttendance(user.id, event.id, 'CONFIRMED')
    const post = await makePost(app, user.id, event.id)

    const created = await app.inject({
      method: 'POST',
      url: `/posts/${post.id}/comments`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { content: 'Para deletar' },
    })
    const comment = created.json()

    const res = await app.inject({
      method: 'DELETE',
      url: `/posts/${post.id}/comments/${comment.id}`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(204)
  })
})
