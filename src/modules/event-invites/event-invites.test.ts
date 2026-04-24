import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import { makeEvent, makeFollow, makeUser } from '../../test/factories'
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

describe('POST /events/:eventId/invites', () => {
  it('autor convida usuários específicos', async () => {
    const author = await makeUser()
    const guest1 = await makeUser()
    const guest2 = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/invites`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: { userIds: [guest1.id, guest2.id] },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ invited: 2 })
  })

  it('convida todos os seguidores quando body é omitido', async () => {
    const author = await makeUser()
    const follower1 = await makeUser()
    const follower2 = await makeUser()
    await makeFollow(follower1.id, author.id)
    await makeFollow(follower2.id, author.id)
    const event = await makeEvent(author.id, { isPublic: false })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/invites`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: {},
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ invited: 2 })
  })

  it('retorna 403 se não for o autor', async () => {
    const author = await makeUser()
    const other = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/invites`,
      headers: { authorization: `Bearer ${token(app, other.id)}` },
      body: { userIds: [other.id] },
    })

    expect(res.statusCode).toBe(403)
  })

  it('retorna 400 para evento público', async () => {
    const author = await makeUser()
    const guest = await makeUser()
    const event = await makeEvent(author.id, { isPublic: true })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/invites`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: { userIds: [guest.id] },
    })

    expect(res.statusCode).toBe(400)
  })

  it('ignora duplicatas (skipDuplicates)', async () => {
    const author = await makeUser()
    const guest = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })

    await app.inject({
      method: 'POST',
      url: `/events/${event.id}/invites`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: { userIds: [guest.id] },
    })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/invites`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: { userIds: [guest.id] },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ invited: 0 })
  })
})

describe('GET /events/:eventId/invites', () => {
  it('autor lista os convidados', async () => {
    const author = await makeUser()
    const guest = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })

    await app.inject({
      method: 'POST',
      url: `/events/${event.id}/invites`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: { userIds: [guest.id] },
    })

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}/invites`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
  })

  it('retorna 403 para não-autor', async () => {
    const author = await makeUser()
    const other = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}/invites`,
      headers: { authorization: `Bearer ${token(app, other.id)}` },
    })

    expect(res.statusCode).toBe(403)
  })
})
