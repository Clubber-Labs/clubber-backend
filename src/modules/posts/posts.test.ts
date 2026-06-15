import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import { makeEvent, makePost, makeUser } from '../../test/factories'
import { fakeStorage } from '../../test/fake-storage'
import { multipartFormData, tinyPngBuffer } from '../../test/image-fixture'
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

describe('POST /events/:eventId/posts', () => {
  it('usuário autenticado cria post em evento público', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id, { isPublic: true })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/posts`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { content: 'Que evento incrível!' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({
      content: 'Que evento incrível!',
      authorId: user.id,
    })
  })

  it('retorna 403 em evento privado sem convite', async () => {
    const author = await makeUser()
    const other = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/posts`,
      headers: { authorization: `Bearer ${token(app, other.id)}` },
      body: { content: 'Tentando postar' },
    })

    expect(res.statusCode).toBe(403)
  })

  it('retorna 401 sem autenticação', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id, { isPublic: true })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/posts`,
      body: { content: 'Sem token' },
    })

    expect(res.statusCode).toBe(401)
  })
})

describe('GET /events/:eventId/posts', () => {
  it('lista posts do evento', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)

    await app.inject({
      method: 'POST',
      url: `/events/${event.id}/posts`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { content: 'Post 1' },
    })

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}/posts`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      data: expect.any(Array),
      nextCursor: null,
    })
    expect(res.json().data.length).toBeGreaterThan(0)
  })
})

describe('DELETE /events/:eventId/posts/:postId', () => {
  it('autor deleta o próprio post', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)

    const created = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/posts`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { content: 'Para deletar' },
    })
    const post = created.json()

    const res = await app.inject({
      method: 'DELETE',
      url: `/events/${event.id}/posts/${post.id}`,
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
      url: `/events/${event.id}/posts`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: { content: 'Post do autor' },
    })
    const post = created.json()

    const res = await app.inject({
      method: 'DELETE',
      url: `/events/${event.id}/posts/${post.id}`,
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
      url: `/events/${event.id}/posts`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { content: 'Post' },
    })
    const post = created.json()

    const res = await app.inject({
      method: 'DELETE',
      url: `/events/${otherEvent.id}/posts/${post.id}`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(404)
  })
})

describe('visibilidade de posts por status do autor', () => {
  it('esconde posts de autor desativado em GET /events/:eventId/posts', async () => {
    const owner = await makeUser()
    const event = await makeEvent(owner.id)
    const activeAuthor = await makeUser()
    const deactivatedAuthor = await makeUser({ accountStatus: 'DEACTIVATED' })
    await testPrisma.post.create({
      data: {
        authorId: activeAuthor.id,
        eventId: event.id,
        content: 'visível',
      },
    })
    await testPrisma.post.create({
      data: {
        authorId: deactivatedAuthor.id,
        eventId: event.id,
        content: 'oculto',
      },
    })

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}/posts`,
      headers: { authorization: `Bearer ${token(app, owner.id)}` },
    })

    expect(res.statusCode).toBe(200)
    const authorIds = res
      .json()
      .data.map((p: { authorId: string }) => p.authorId)
    expect(authorIds).toContain(activeAuthor.id)
    expect(authorIds).not.toContain(deactivatedAuthor.id)
  })
})

describe('POST /events/:eventId/posts/:postId/images', () => {
  it('autor sobe imagem e ela aparece na listagem do post', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id)
    const post = await makePost(author.id, event.id)
    const png = await tinyPngBuffer()
    const { body, contentType } = multipartFormData(
      png,
      'file',
      'foto.png',
      'image/png',
    )

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/posts/${post.id}/images`,
      headers: {
        authorization: `Bearer ${token(app, author.id)}`,
        'content-type': contentType,
      },
      payload: body,
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ format: 'webp', order: 0 })
    expect(res.json()).not.toHaveProperty('key')
    expect(fakeStorage.uploads[fakeStorage.uploads.length - 1]?.key).toContain(
      `posts/${post.id}/`,
    )

    const list = await app.inject({
      method: 'GET',
      url: `/events/${event.id}/posts`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })
    const created = list
      .json()
      .data.find((p: { id: string }) => p.id === post.id)
    expect(created.images).toHaveLength(1)
    expect(created.images[0]).toMatchObject({ format: 'webp', order: 0 })
  })

  it('retorna 403 quando não é o autor do post', async () => {
    const author = await makeUser()
    const other = await makeUser()
    const event = await makeEvent(author.id, { isPublic: true })
    const post = await makePost(author.id, event.id)
    const png = await tinyPngBuffer()
    const { body, contentType } = multipartFormData(
      png,
      'file',
      'foto.png',
      'image/png',
    )

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/posts/${post.id}/images`,
      headers: {
        authorization: `Bearer ${token(app, other.id)}`,
        'content-type': contentType,
      },
      payload: body,
    })

    expect(res.statusCode).toBe(403)
  })

  it('retorna 400 sem arquivo', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id)
    const post = await makePost(author.id, event.id)

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/posts/${post.id}/images`,
      headers: {
        authorization: `Bearer ${token(app, author.id)}`,
        'content-type': 'multipart/form-data; boundary=----X',
      },
      payload: '------X--\r\n',
    })

    expect(res.statusCode).toBe(400)
  })

  it('retorna 404 para post inexistente', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id)
    const png = await tinyPngBuffer()
    const { body, contentType } = multipartFormData(
      png,
      'file',
      'foto.png',
      'image/png',
    )

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/posts/00000000-0000-0000-0000-000000000000/images`,
      headers: {
        authorization: `Bearer ${token(app, author.id)}`,
        'content-type': contentType,
      },
      payload: body,
    })

    expect(res.statusCode).toBe(404)
  })

  it('retorna 409 ao exceder o limite de imagens por post', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id)
    const post = await makePost(author.id, event.id)
    // Pré-popula o teto (10) direto no banco para não subir 10 imagens.
    await testPrisma.postImage.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({
        url: `https://fake.storage/posts/${post.id}/${i}.webp`,
        key: `posts/${post.id}/${i}.webp`,
        format: 'webp',
        size: 100,
        order: i,
        postId: post.id,
      })),
    })
    const png = await tinyPngBuffer()
    const { body, contentType } = multipartFormData(
      png,
      'file',
      'foto.png',
      'image/png',
    )

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/posts/${post.id}/images`,
      headers: {
        authorization: `Bearer ${token(app, author.id)}`,
        'content-type': contentType,
      },
      payload: body,
    })

    expect(res.statusCode).toBe(409)
  })

  it('retorna 401 sem autenticação', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id)
    const post = await makePost(author.id, event.id)

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/posts/${post.id}/images`,
      headers: { 'content-type': 'multipart/form-data; boundary=----X' },
      payload: '------X--\r\n',
    })

    expect(res.statusCode).toBe(401)
  })
})
