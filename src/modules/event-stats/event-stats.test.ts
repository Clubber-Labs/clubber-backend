import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import {
  makeAnalyticsMetric,
  makeAttendance,
  makeEvent,
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

function statsExportUrl(eventId: string) {
  return `/events/${eventId}/stats/export`
}

function viewUrl(eventId: string) {
  return `/events/${eventId}/analytics/view`
}

function shareUrl(eventId: string) {
  return `/events/${eventId}/analytics/share`
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
  it('retorna visualizações, compartilhamentos, confirmações e timeline para o autor premium', async () => {
    const author = await makeUser({ isPremium: true })
    const event = await makeEvent(author.id)

    const [a, b, c] = await Promise.all([makeUser(), makeUser(), makeUser()])
    const day1 = new Date('2026-06-01T12:00:00Z')
    const day2 = new Date('2026-06-02T15:00:00Z')
    await makeAnalyticsMetric(event.id, 'VIEW', day1)
    await makeAnalyticsMetric(event.id, 'SHARE', day1)
    await makeAnalyticsMetric(event.id, 'VIEW', day2)
    await makeAttendance(a.id, event.id, 'CONFIRMED', { createdAt: day1 })
    await makeAttendance(b.id, event.id, 'CONFIRMED', { createdAt: day2 })
    await makeAttendance(c.id, event.id, 'INTERESTED', { createdAt: day2 })

    const res = await app.inject({
      method: 'GET',
      url: statsUrl(event.id),
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.eventId).toBe(event.id)
    expect(body.updatedAt).toEqual(expect.any(String))
    expect(body.totals).toEqual({
      views: 2,
      shares: 1,
      confirmations: 2,
    })
    expect(body.timeline).toEqual([
      { date: '2026-06-01', views: 1, shares: 1, confirmations: 1 },
      { date: '2026-06-02', views: 1, shares: 0, confirmations: 1 },
    ])
  })

  it('retorna zeros e timeline vazia para evento sem dados', async () => {
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
      views: 0,
      shares: 0,
      confirmations: 0,
    })
    expect(body.timeline).toEqual([])
  })

  it('aceita refresh=true para atualização manual do dashboard', async () => {
    const author = await makeUser({ isPremium: true })
    const event = await makeEvent(author.id)

    const res = await app.inject({
      method: 'GET',
      url: `${statsUrl(event.id)}?refresh=true`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })

    expect(res.statusCode).toBe(200)
  })

  it('não conta interessados ou recusas porque o TCC pede somente confirmações', async () => {
    const author = await makeUser({ isPremium: true })
    const event = await makeEvent(author.id)
    const [interested, declined] = await Promise.all([makeUser(), makeUser()])
    await makeAttendance(interested.id, event.id, 'INTERESTED')
    await makeAttendance(declined.id, event.id, 'NOT_INTERESTED')

    const res = await app.inject({
      method: 'GET',
      url: statsUrl(event.id),
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.totals.confirmations).toBe(0)
    expect(body.timeline).toEqual([])
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

describe('POST /events/:id/analytics/view', () => {
  it('registra visualização autenticada de evento público', async () => {
    const author = await makeUser({ isPremium: true })
    const event = await makeEvent(author.id, { isPublic: true })
    const viewer = await makeUser()

    const res = await app.inject({
      method: 'POST',
      url: viewUrl(event.id),
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
      payload: {},
    })

    expect(res.statusCode).toBe(204)

    const stats = await app.inject({
      method: 'GET',
      url: statsUrl(event.id),
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })
    expect(stats.json().totals.views).toBe(1)
    expect(stats.json().timeline).toHaveLength(1)
  })

  it('retorna 401 para visualização sem autenticação', async () => {
    const author = await makeUser({ isPremium: true })
    const event = await makeEvent(author.id, { isPublic: true })

    const res = await app.inject({
      method: 'POST',
      url: viewUrl(event.id),
      payload: {},
    })

    expect(res.statusCode).toBe(401)
  })

  it('retorna 403 ao tentar registrar view em evento privado sem acesso', async () => {
    const author = await makeUser({ isPremium: true })
    const event = await makeEvent(author.id, { isPublic: false })
    const outsider = await makeUser()

    const res = await app.inject({
      method: 'POST',
      url: viewUrl(event.id),
      headers: { authorization: `Bearer ${token(app, outsider.id)}` },
      payload: {},
    })

    expect(res.statusCode).toBe(403)
  })
})

describe('POST /events/:id/analytics/share', () => {
  it('registra compartilhamento autenticado de evento público', async () => {
    const author = await makeUser({ isPremium: true })
    const event = await makeEvent(author.id, { isPublic: true })
    const viewer = await makeUser()

    const res = await app.inject({
      method: 'POST',
      url: shareUrl(event.id),
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
      payload: {},
    })

    expect(res.statusCode).toBe(204)

    const stats = await app.inject({
      method: 'GET',
      url: statsUrl(event.id),
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })
    expect(stats.json().totals.shares).toBe(1)
    expect(stats.json().timeline).toHaveLength(1)
  })

  it('retorna 401 para compartilhamento sem autenticação', async () => {
    const author = await makeUser({ isPremium: true })
    const event = await makeEvent(author.id, { isPublic: true })

    const res = await app.inject({
      method: 'POST',
      url: shareUrl(event.id),
      payload: {},
    })

    expect(res.statusCode).toBe(401)
  })

  it('retorna 403 ao tentar registrar share em evento privado sem acesso', async () => {
    const author = await makeUser({ isPremium: true })
    const event = await makeEvent(author.id, { isPublic: false })
    const outsider = await makeUser()

    const res = await app.inject({
      method: 'POST',
      url: shareUrl(event.id),
      headers: { authorization: `Bearer ${token(app, outsider.id)}` },
      payload: {},
    })

    expect(res.statusCode).toBe(403)
  })
})

describe('GET /events/:id/stats/export', () => {
  it('exporta CSV com visualizações, compartilhamentos e confirmações', async () => {
    const author = await makeUser({ isPremium: true })
    const event = await makeEvent(author.id)
    const viewer = await makeUser()
    const day = new Date('2026-06-05T12:00:00Z')
    await makeAnalyticsMetric(event.id, 'VIEW', day)
    await makeAnalyticsMetric(event.id, 'SHARE', day)
    await makeAttendance(viewer.id, event.id, 'CONFIRMED', { createdAt: day })

    const res = await app.inject({
      method: 'GET',
      url: statsExportUrl(event.id),
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.body.trim()).toBe(
      [
        'data,visualizacoes,compartilhamentos,confirmacoes',
        '2026-06-05,1,1,1',
      ].join('\n'),
    )
  })

  it('mantém export restrito ao autor premium', async () => {
    const author = await makeUser({ isPremium: true })
    const event = await makeEvent(author.id)
    const other = await makeUser({ isPremium: true })

    const res = await app.inject({
      method: 'GET',
      url: statsExportUrl(event.id),
      headers: { authorization: `Bearer ${token(app, other.id)}` },
    })

    expect(res.statusCode).toBe(403)
  })
})
