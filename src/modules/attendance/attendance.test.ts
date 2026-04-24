import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import {
  makeAttendance,
  makeEvent,
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

describe('POST /events/:eventId/attendances', () => {
  it('confirma presença em evento público', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/attendances`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { type: 'CONFIRMED' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ type: 'CONFIRMED', userId: user.id })
  })

  it('atualiza tipo de presença se já existir', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)
    await makeAttendance(user.id, event.id, 'INTERESTED')

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/attendances`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { type: 'CONFIRMED' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ type: 'CONFIRMED' })

    const count = await testPrisma.eventAttendance.count({
      where: { userId: user.id, eventId: event.id },
    })
    expect(count).toBe(1)
  })

  it('retorna o mesmo registro se o tipo não mudou', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)
    await makeAttendance(user.id, event.id, 'CONFIRMED')

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/attendances`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { type: 'CONFIRMED' },
    })

    expect(res.statusCode).toBe(201)
  })

  it('retorna 403 para evento privado sem convite', async () => {
    const author = await makeUser()
    const other = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/attendances`,
      headers: { authorization: `Bearer ${token(app, other.id)}` },
      body: { type: 'CONFIRMED' },
    })

    expect(res.statusCode).toBe(403)
  })

  it('permite presença em evento privado com convite', async () => {
    const author = await makeUser()
    const guest = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })
    await makeInvite(event.id, author.id, guest.id)

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/attendances`,
      headers: { authorization: `Bearer ${token(app, guest.id)}` },
      body: { type: 'CONFIRMED' },
    })

    expect(res.statusCode).toBe(201)
  })

  it('retorna 401 sem autenticação', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/attendances`,
      body: { type: 'CONFIRMED' },
    })

    expect(res.statusCode).toBe(401)
  })
})

describe('DELETE /events/:eventId/attendances', () => {
  it('cancela presença existente', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)
    await makeAttendance(user.id, event.id)

    const res = await app.inject({
      method: 'DELETE',
      url: `/events/${event.id}/attendances`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(204)
  })

  it('retorna 404 se não tinha presença', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)

    const res = await app.inject({
      method: 'DELETE',
      url: `/events/${event.id}/attendances`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(404)
  })
})
