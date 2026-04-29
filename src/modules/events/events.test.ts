import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import { makeEvent, makeInvite, makeUser } from '../../test/factories'
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

describe('GET /events', () => {
  it('lista eventos públicos sem autenticação', async () => {
    const user = await makeUser()
    await makeEvent(user.id, { isPublic: true })
    await makeEvent(user.id, { isPublic: false })

    const res = await app.inject({ method: 'GET', url: '/events' })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveProperty('data')
    expect(body).toHaveProperty('nextCursor')
    expect(
      body.data.every(
        (e: { isPublic: boolean; recentComments: unknown[] }) =>
          e.isPublic && Array.isArray(e.recentComments),
      ),
    ).toBe(true)
  })

  it('retorna userReaction e userAttendance quando autenticado', async () => {
    const author = await makeUser()
    const viewer = await makeUser()
    await makeEvent(author.id, { isPublic: true })

    const res = await app.inject({
      method: 'GET',
      url: '/events',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data.length).toBeGreaterThan(0)
    expect(body.data[0]).toMatchObject({
      recentComments: [],
      userReaction: null,
      userAttendance: null,
    })
  })
})

describe('GET /events/:id', () => {
  it('retorna evento público sem autenticação', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id, { isPublic: true })

    const res = await app.inject({ method: 'GET', url: `/events/${event.id}` })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ id: event.id })
  })

  it('retorna 401 para evento privado sem token', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id, { isPublic: false })

    const res = await app.inject({ method: 'GET', url: `/events/${event.id}` })

    expect(res.statusCode).toBe(401)
  })

  it('retorna evento privado para o autor', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id, { isPublic: false })

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(200)
  })

  it('retorna evento privado para convidado', async () => {
    const author = await makeUser()
    const guest = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })
    await makeInvite(event.id, author.id, guest.id)

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}`,
      headers: { authorization: `Bearer ${token(app, guest.id)}` },
    })

    expect(res.statusCode).toBe(200)
  })

  it('retorna 403 para evento privado sem convite', async () => {
    const author = await makeUser()
    const other = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}`,
      headers: { authorization: `Bearer ${token(app, other.id)}` },
    })

    expect(res.statusCode).toBe(403)
  })

  it('retorna 404 para evento inexistente', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: '/events/00000000-0000-0000-0000-000000000000',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(404)
  })
})

describe('POST /events', () => {
  it('cria evento autenticado', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'POST',
      url: '/events',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: {
        title: 'Festa de verão',
        description: 'Uma festa incrível',
        date: new Date(Date.now() + 86400000).toISOString(),
        latitude: -25.4,
        longitude: -49.3,
        category: 'Festa',
        isPublic: true,
      },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({
      title: 'Festa de verão',
      authorId: user.id,
    })
  })

  it('retorna 401 sem autenticação', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/events',
      body: {
        title: 'Evento',
        description: 'Desc',
        date: new Date().toISOString(),
        latitude: -25.4,
        longitude: -49.3,
        category: 'Festa',
        isPublic: true,
      },
    })

    expect(res.statusCode).toBe(401)
  })
})

describe('DELETE /events/:id', () => {
  it('autor deleta o próprio evento', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)

    const res = await app.inject({
      method: 'DELETE',
      url: `/events/${event.id}`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(204)
  })

  it('retorna 403 se não for o autor', async () => {
    const author = await makeUser()
    const other = await makeUser()
    const event = await makeEvent(author.id)

    const res = await app.inject({
      method: 'DELETE',
      url: `/events/${event.id}`,
      headers: { authorization: `Bearer ${token(app, other.id)}` },
    })

    expect(res.statusCode).toBe(403)
  })
})

describe('POST /events/:id/images', () => {
  it('autor sobe imagem válida', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id)
    const png = await tinyPngBuffer()
    const { body, contentType } = multipartFormData(png, 'file', 'capa.png', 'image/png')

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/images`,
      headers: {
        authorization: `Bearer ${token(app, author.id)}`,
        'content-type': contentType,
      },
      payload: body,
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ format: 'webp', eventId: event.id })
    expect(fakeStorage.uploads).toHaveLength(1)
    expect(fakeStorage.uploads[0].key).toContain(`events/${event.id}/`)

    const detail = await app.inject({ method: 'GET', url: `/events/${event.id}` })
    expect(detail.statusCode).toBe(200)
    expect(detail.json().images).toHaveLength(1)
    expect(detail.json().images[0]).toMatchObject({ format: 'webp', order: 0 })
  })

  it('retorna 400 sem arquivo', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id)

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/images`,
      headers: {
        authorization: `Bearer ${token(app, author.id)}`,
        'content-type': 'multipart/form-data; boundary=----X',
      },
      payload: '------X--\r\n',
    })

    expect(res.statusCode).toBe(400)
  })

  it('retorna 400 com mimetype inválido', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id)
    const { body, contentType } = multipartFormData(
      Buffer.from('fake'),
      'file',
      'doc.pdf',
      'application/pdf',
    )

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/images`,
      headers: {
        authorization: `Bearer ${token(app, author.id)}`,
        'content-type': contentType,
      },
      payload: body,
    })

    expect(res.statusCode).toBe(400)
  })

  it('retorna 401 sem autenticação', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id)
    const png = await tinyPngBuffer()
    const { body, contentType } = multipartFormData(png, 'file', 'capa.png', 'image/png')

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/images`,
      headers: { 'content-type': contentType },
      payload: body,
    })

    expect(res.statusCode).toBe(401)
  })

  it('retorna 403 se requester não for o autor', async () => {
    const author = await makeUser()
    const other = await makeUser()
    const event = await makeEvent(author.id)
    const png = await tinyPngBuffer()
    const { body, contentType } = multipartFormData(png, 'file', 'capa.png', 'image/png')

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/images`,
      headers: {
        authorization: `Bearer ${token(app, other.id)}`,
        'content-type': contentType,
      },
      payload: body,
    })

    expect(res.statusCode).toBe(403)
  })
})
