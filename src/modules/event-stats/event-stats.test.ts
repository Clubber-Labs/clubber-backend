import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import {
  makeAttendance,
  makeComment,
  makeEvent,
  makeInvite,
  makePost,
  makeReaction,
  makeUser,
} from '../../test/factories'
import { testPrisma } from '../../test/prisma'

let app: FastifyInstance

function token(app: FastifyInstance, userId: string) {
  return app.jwt.sign({ sub: userId })
}

function statsUrl(eventId: string) {
  return `/events/${eventId}/stats`
}

beforeAll(async () => {
  app = buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await testPrisma.$disconnect()
})

describe('GET /events/:id/stats', () => {
  it('retorna totais, taxa de confirmação e timeline para o autor premium', async () => {
    const author = await makeUser({ isPremium: true })
    const event = await makeEvent(author.id)

    const [a, b, c, d, e, f] = await Promise.all([
      makeUser(),
      makeUser(),
      makeUser(),
      makeUser(),
      makeUser(),
      makeUser(),
    ])
    await makeAttendance(a.id, event.id, 'INTERESTED')
    await makeAttendance(b.id, event.id, 'INTERESTED')
    await makeAttendance(c.id, event.id, 'CONFIRMED')
    await makeAttendance(d.id, event.id, 'CONFIRMED')
    await makeAttendance(e.id, event.id, 'CONFIRMED')
    await makeAttendance(f.id, event.id, 'NOT_INTERESTED')

    await makeReaction(a.id, event.id)
    await makeReaction(b.id, event.id)
    await makeComment(a.id, event.id)
    await makePost(author.id, event.id)
    await makeInvite(event.id, author.id, e.id)
    await makeInvite(event.id, author.id, f.id)

    const res = await app.inject({
      method: 'GET',
      url: statsUrl(event.id),
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.eventId).toBe(event.id)
    expect(body.totals).toEqual({
      interested: 2,
      confirmed: 3,
      notInterested: 1,
      reactions: 2,
      comments: 1,
      posts: 1,
      invitesSent: 2,
    })
    // 3 confirmados / (2 interessados + 3 confirmados)
    expect(body.confirmationRate).toBeCloseTo(0.6)
    // Todas criadas agora → um único dia na timeline
    expect(body.timeline).toHaveLength(1)
    expect(body.timeline[0]).toEqual({
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      interested: 2,
      confirmed: 3,
    })
  })

  it('retorna zeros, timeline vazia e taxa null para evento sem dados', async () => {
    const author = await makeUser({ isPremium: true })
    const event = await makeEvent(author.id)

    const res = await app.inject({
      method: 'GET',
      url: statsUrl(event.id),
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.totals).toEqual({
      interested: 0,
      confirmed: 0,
      notInterested: 0,
      reactions: 0,
      comments: 0,
      posts: 0,
      invitesSent: 0,
    })
    expect(body.confirmationRate).toBeNull()
    expect(body.timeline).toEqual([])
  })

  it('agrupa a timeline por dia em ordem ascendente', async () => {
    const author = await makeUser({ isPremium: true })
    const event = await makeEvent(author.id)
    const [a, b, c] = await Promise.all([makeUser(), makeUser(), makeUser()])

    const day1 = new Date('2026-06-01T12:00:00Z')
    const day2 = new Date('2026-06-02T15:00:00Z')
    await makeAttendance(a.id, event.id, 'INTERESTED', { createdAt: day1 })
    await makeAttendance(b.id, event.id, 'CONFIRMED', { createdAt: day1 })
    await makeAttendance(c.id, event.id, 'CONFIRMED', { createdAt: day2 })

    const res = await app.inject({
      method: 'GET',
      url: statsUrl(event.id),
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().timeline).toEqual([
      { date: '2026-06-01', interested: 1, confirmed: 1 },
      { date: '2026-06-02', interested: 0, confirmed: 1 },
    ])
  })

  it('conta NOT_INTERESTED nos totais mas não na timeline', async () => {
    const author = await makeUser({ isPremium: true })
    const event = await makeEvent(author.id)
    const viewer = await makeUser()
    await makeAttendance(viewer.id, event.id, 'NOT_INTERESTED')

    const res = await app.inject({
      method: 'GET',
      url: statsUrl(event.id),
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.totals.notInterested).toBe(1)
    expect(body.timeline).toEqual([])
    expect(body.confirmationRate).toBeNull()
  })

  it('retorna 401 sem autenticação', async () => {
    const author = await makeUser({ isPremium: true })
    const event = await makeEvent(author.id)

    const res = await app.inject({ method: 'GET', url: statsUrl(event.id) })

    expect(res.statusCode).toBe(401)
  })

  it('retorna 403 quando o requester não é premium', async () => {
    const author = await makeUser({ isPremium: false })
    const event = await makeEvent(author.id)

    const res = await app.inject({
      method: 'GET',
      url: statsUrl(event.id),
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })

    expect(res.statusCode).toBe(403)
  })

  it('retorna 403 quando o autor perdeu o premium depois de criar o evento', async () => {
    const author = await makeUser({ isPremium: true })
    const event = await makeEvent(author.id)
    await testPrisma.user.update({
      where: { id: author.id },
      data: { isPremium: false },
    })

    const res = await app.inject({
      method: 'GET',
      url: statsUrl(event.id),
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })

    expect(res.statusCode).toBe(403)
  })

  it('retorna 403 quando o requester premium não é o autor', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id)
    const other = await makeUser({ isPremium: true })

    const res = await app.inject({
      method: 'GET',
      url: statsUrl(event.id),
      headers: { authorization: `Bearer ${token(app, other.id)}` },
    })

    expect(res.statusCode).toBe(403)
  })

  it('retorna 404 para evento inexistente', async () => {
    const viewer = await makeUser({ isPremium: true })

    const res = await app.inject({
      method: 'GET',
      url: statsUrl('00000000-0000-0000-0000-000000000000'),
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.statusCode).toBe(404)
  })

  it('retorna 400 para id malformado', async () => {
    const viewer = await makeUser({ isPremium: true })

    const res = await app.inject({
      method: 'GET',
      url: statsUrl('nao-e-uuid'),
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.statusCode).toBe(400)
  })
})
