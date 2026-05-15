import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import {
  makeAttendance,
  makeComment,
  makeEvent,
  makeUser,
} from '../../test/factories'
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
  it('curtir evento (binário, sem body)', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/reactions`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ userId: user.id, eventId: event.id })
  })

  it('curtir duas vezes é idempotente (mesmo registro)', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)

    await app.inject({
      method: 'POST',
      url: `/events/${event.id}/reactions`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })
    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/reactions`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(201)
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
    })

    expect(res.statusCode).toBe(403)
  })
})

describe('DELETE /events/:eventId/reactions', () => {
  it('remove like do evento', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)

    await app.inject({
      method: 'POST',
      url: `/events/${event.id}/reactions`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
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
  it('curtir post', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)
    await makeAttendance(user.id, event.id, 'CONFIRMED')
    const post = await makePost(app, user.id, event.id)

    const res = await app.inject({
      method: 'POST',
      url: `/posts/${post.id}/reactions`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ userId: user.id, postId: post.id })
  })
})

describe('DELETE /posts/:postId/reactions', () => {
  it('remove like do post', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)
    await makeAttendance(user.id, event.id, 'CONFIRMED')
    const post = await makePost(app, user.id, event.id)

    await app.inject({
      method: 'POST',
      url: `/posts/${post.id}/reactions`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    const res = await app.inject({
      method: 'DELETE',
      url: `/posts/${post.id}/reactions`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(204)
  })
})

describe('POST /comments/:commentId/reactions', () => {
  it('curtir comentário de evento', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)
    const comment = await makeComment(user.id, event.id)

    const res = await app.inject({
      method: 'POST',
      url: `/comments/${comment.id}/reactions`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({
      userId: user.id,
      commentId: comment.id,
    })
  })

  it('curtir duas vezes é idempotente', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)
    const comment = await makeComment(user.id, event.id)

    await app.inject({
      method: 'POST',
      url: `/comments/${comment.id}/reactions`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })
    const res = await app.inject({
      method: 'POST',
      url: `/comments/${comment.id}/reactions`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(201)
    const count = await testPrisma.commentReaction.count({
      where: { userId: user.id, commentId: comment.id },
    })
    expect(count).toBe(1)
  })

  it('retorna 403 em comentário de evento privado sem acesso', async () => {
    const author = await makeUser()
    const other = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })
    const comment = await makeComment(author.id, event.id)

    const res = await app.inject({
      method: 'POST',
      url: `/comments/${comment.id}/reactions`,
      headers: { authorization: `Bearer ${token(app, other.id)}` },
    })

    expect(res.statusCode).toBe(403)
  })

  it('retorna 404 quando comentário não existe', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'POST',
      url: '/comments/00000000-0000-0000-0000-000000000000/reactions',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(404)
  })

  it('curtir comentário de post (resolve evento via post)', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id)
    await makeAttendance(author.id, event.id, 'CONFIRMED')
    const post = await makePost(app, author.id, event.id)
    const commentRes = await app.inject({
      method: 'POST',
      url: `/posts/${post.id}/comments`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: { content: 'Comentário no post' },
    })
    const comment = commentRes.json()

    const res = await app.inject({
      method: 'POST',
      url: `/comments/${comment.id}/reactions`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({
      userId: author.id,
      commentId: comment.id,
    })
  })

  it('retorna 403 ao curtir comentário de post em evento privado sem acesso', async () => {
    const author = await makeUser()
    const stranger = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })
    await makeAttendance(author.id, event.id, 'CONFIRMED')
    const post = await makePost(app, author.id, event.id)
    const commentRes = await app.inject({
      method: 'POST',
      url: `/posts/${post.id}/comments`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: { content: 'Comentário em evento privado' },
    })
    const comment = commentRes.json()

    const res = await app.inject({
      method: 'POST',
      url: `/comments/${comment.id}/reactions`,
      headers: { authorization: `Bearer ${token(app, stranger.id)}` },
    })

    expect(res.statusCode).toBe(403)
  })
})

describe('DELETE /comments/:commentId/reactions', () => {
  it('remove like do comentário', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)
    const comment = await makeComment(user.id, event.id)

    await app.inject({
      method: 'POST',
      url: `/comments/${comment.id}/reactions`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    const res = await app.inject({
      method: 'DELETE',
      url: `/comments/${comment.id}/reactions`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(204)
  })

  it('retorna 404 sem like prévio', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)
    const comment = await makeComment(user.id, event.id)

    const res = await app.inject({
      method: 'DELETE',
      url: `/comments/${comment.id}/reactions`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(404)
  })
})
