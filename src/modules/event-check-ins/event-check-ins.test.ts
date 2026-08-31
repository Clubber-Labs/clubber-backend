import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import {
  makeAttendance,
  makeEvent,
  makeFollow,
  makeUser,
} from '../../test/factories'
import { testPrisma } from '../../test/prisma'

let app: FastifyInstance

function token(app: FastifyInstance, userId: string) {
  return app.jwt.sign({ sub: userId })
}

/** Evento acontecendo agora: começou há 1h e termina daqui a 1h. */
function liveWindow() {
  return {
    date: new Date(Date.now() - 3600_000),
    endDate: new Date(Date.now() + 3600_000),
  }
}

beforeAll(async () => {
  app = buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await testPrisma.$disconnect()
})

describe('POST /events/:eventId/check-ins', () => {
  it('registra a chegada em evento ao vivo', async () => {
    const author = await makeUser()
    const guest = await makeUser()
    const event = await makeEvent(author.id, liveWindow())

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/check-ins`,
      headers: { authorization: `Bearer ${token(app, guest.id)}` },
    })

    expect(res.statusCode).toBe(201)
    const rows = await testPrisma.eventCheckIn.findMany({
      where: { eventId: event.id },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].userId).toBe(guest.id)
  })

  it('repetir o check-in não duplica nem falha', async () => {
    const author = await makeUser()
    const guest = await makeUser()
    const event = await makeEvent(author.id, liveWindow())
    const headers = { authorization: `Bearer ${token(app, guest.id)}` }

    const first = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/check-ins`,
      headers,
    })
    const second = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/check-ins`,
      headers,
    })

    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(201)
    expect(
      await testPrisma.eventCheckIn.count({ where: { eventId: event.id } }),
    ).toBe(1)
  })

  // Estar no evento é sinal mais forte que ter dito que vinha: sem isso o
  // resumo do autor mostraria mais gente chegando do que confirmada.
  it('chegar confirma a presença de quem só estava interessado', async () => {
    const author = await makeUser()
    const guest = await makeUser()
    const event = await makeEvent(author.id, liveWindow())
    await makeAttendance(guest.id, event.id, 'INTERESTED')

    await app.inject({
      method: 'POST',
      url: `/events/${event.id}/check-ins`,
      headers: { authorization: `Bearer ${token(app, guest.id)}` },
    })

    const attendance = await testPrisma.eventAttendance.findUnique({
      where: { userId_eventId: { userId: guest.id, eventId: event.id } },
    })
    expect(attendance?.type).toBe('CONFIRMED')
  })

  it('confirma a presença de quem chega sem ter dado RSVP', async () => {
    const author = await makeUser()
    const guest = await makeUser()
    const event = await makeEvent(author.id, liveWindow())

    await app.inject({
      method: 'POST',
      url: `/events/${event.id}/check-ins`,
      headers: { authorization: `Bearer ${token(app, guest.id)}` },
    })

    const attendance = await testPrisma.eventAttendance.findUnique({
      where: { userId_eventId: { userId: guest.id, eventId: event.id } },
    })
    expect(attendance?.type).toBe('CONFIRMED')
  })

  it('retorna 400 em evento que ainda não começou', async () => {
    const author = await makeUser()
    const guest = await makeUser()
    const event = await makeEvent(author.id, {
      date: new Date(Date.now() + 86400_000),
    })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/check-ins`,
      headers: { authorization: `Bearer ${token(app, guest.id)}` },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('EVENT_NOT_STARTED')
  })

  it('retorna 400 em evento já encerrado', async () => {
    const author = await makeUser()
    const guest = await makeUser()
    const event = await makeEvent(author.id, {
      date: new Date(Date.now() - 172800_000),
      endDate: new Date(Date.now() - 86400_000),
    })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/check-ins`,
      headers: { authorization: `Bearer ${token(app, guest.id)}` },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('EVENT_ENDED')
  })

  it('retorna 400 em evento cancelado', async () => {
    const author = await makeUser()
    const guest = await makeUser()
    const event = await makeEvent(author.id, {
      ...liveWindow(),
      canceledAt: new Date(),
    })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/check-ins`,
      headers: { authorization: `Bearer ${token(app, guest.id)}` },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('EVENT_CANCELED')
  })

  it('retorna 403 em evento privado sem acesso', async () => {
    const author = await makeUser()
    const stranger = await makeUser()
    const event = await makeEvent(author.id, {
      ...liveWindow(),
      isPublic: false,
    })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/check-ins`,
      headers: { authorization: `Bearer ${token(app, stranger.id)}` },
    })

    expect(res.statusCode).toBe(403)
  })

  it('retorna 404 para evento inexistente', async () => {
    const guest = await makeUser()

    const res = await app.inject({
      method: 'POST',
      url: '/events/11111111-1111-4111-8111-111111111111/check-ins',
      headers: { authorization: `Bearer ${token(app, guest.id)}` },
    })

    expect(res.statusCode).toBe(404)
  })

  // Mesma régua do GET /events/:id: evento de autor invisível não existe para
  // quem chega. Sem isso, a tela some mas o "cheguei" continuaria respondendo.
  it('retorna 404 em evento de autor desativado', async () => {
    const author = await makeUser({ accountStatus: 'DEACTIVATED' })
    const guest = await makeUser()
    const event = await makeEvent(author.id, liveWindow())

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/check-ins`,
      headers: { authorization: `Bearer ${token(app, guest.id)}` },
    })

    expect(res.statusCode).toBe(404)
  })

  it('retorna 401 sem autenticação', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id, liveWindow())

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/check-ins`,
    })

    expect(res.statusCode).toBe(401)
  })
})

describe('checkIns em GET /events/:id', () => {
  it('traz contagem, estado do viewer e quem chegou', async () => {
    const author = await makeUser()
    const guest = await makeUser()
    const event = await makeEvent(author.id, liveWindow())
    await app.inject({
      method: 'POST',
      url: `/events/${event.id}/check-ins`,
      headers: { authorization: `Bearer ${token(app, guest.id)}` },
    })

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}`,
      headers: { authorization: `Bearer ${token(app, guest.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().checkIns).toMatchObject({
      count: 1,
      viewerCheckedIn: true,
    })
    expect(res.json().checkIns.top).toHaveLength(1)
    expect(res.json().checkIns.top[0].user.id).toBe(guest.id)
  })

  it('viewerCheckedIn é falso para quem não chegou', async () => {
    const author = await makeUser()
    const arrived = await makeUser()
    const watcher = await makeUser()
    const event = await makeEvent(author.id, liveWindow())
    await app.inject({
      method: 'POST',
      url: `/events/${event.id}/check-ins`,
      headers: { authorization: `Bearer ${token(app, arrived.id)}` },
    })

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}`,
      headers: { authorization: `Bearer ${token(app, watcher.id)}` },
    })

    expect(res.json().checkIns).toMatchObject({
      count: 1,
      viewerCheckedIn: false,
    })
  })

  it('anônimo recebe checkIns sem estado de viewer', async () => {
    const author = await makeUser()
    const guest = await makeUser()
    const event = await makeEvent(author.id, liveWindow())
    await app.inject({
      method: 'POST',
      url: `/events/${event.id}/check-ins`,
      headers: { authorization: `Bearer ${token(app, guest.id)}` },
    })

    const res = await app.inject({ method: 'GET', url: `/events/${event.id}` })

    expect(res.json().checkIns).toMatchObject({
      count: 1,
      viewerCheckedIn: false,
    })
  })

  it('ordena quem chegou com amigos primeiro', async () => {
    const author = await makeUser()
    const viewer = await makeUser()
    const stranger = await makeUser()
    const friend = await makeUser()
    await makeFollow(viewer.id, friend.id)
    const event = await makeEvent(author.id, liveWindow())

    for (const user of [stranger, friend]) {
      await app.inject({
        method: 'POST',
        url: `/events/${event.id}/check-ins`,
        headers: { authorization: `Bearer ${token(app, user.id)}` },
      })
    }

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}`,
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    const top = res.json().checkIns.top
    expect(top).toHaveLength(2)
    expect(top[0].user.id).toBe(friend.id)
  })

  it('evento sem chegadas devolve contagem zerada', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id, liveWindow())

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })

    expect(res.json().checkIns).toEqual({
      count: 0,
      viewerCheckedIn: false,
      top: [],
    })
  })
})
