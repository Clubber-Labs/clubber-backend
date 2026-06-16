import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import { makeEvent, makeEventSeries, makeUser } from '../../test/factories'
import { testPrisma } from '../../test/prisma'
import { reconcileRecurringSeries } from './recurring-events.reconciler'

let app: FastifyInstance

function token(app: FastifyInstance, userId: string) {
  return app.jwt.sign({ sub: userId })
}

const DAY = 86_400_000

function baseEventBody(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Futeba de quarta',
    date: new Date(Date.now() + DAY).toISOString(),
    latitude: -25.43,
    longitude: -49.27,
    categories: ['SPORTS'],
    isPublic: true,
    ...overrides,
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

describe('POST /events com recurrence', () => {
  it('premium cria série WEEKLY: várias ocorrências, mesmo seriesId, espaçadas 7d, lat/lng herdados', async () => {
    const author = await makeUser({ isPremium: true })
    const date = new Date(Date.now() + DAY)

    const res = await app.inject({
      method: 'POST',
      url: '/events',
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: baseEventBody({
        date: date.toISOString(),
        recurrence: { frequency: 'WEEKLY', count: 4 },
      }),
    })

    expect(res.statusCode).toBe(201)
    const first = res.json()
    expect(first.seriesId).toBeTruthy()

    const occurrences = await testPrisma.event.findMany({
      where: { seriesId: first.seriesId },
      orderBy: { date: 'asc' },
    })
    expect(occurrences).toHaveLength(4)
    // mesma série, mesma localização
    for (const o of occurrences) {
      expect(o.seriesId).toBe(first.seriesId)
      expect(o.latitude).toBeCloseTo(-25.43)
      expect(o.longitude).toBeCloseTo(-49.27)
    }
    // espaçamento de 7 dias
    const t0 = occurrences[0].date.getTime()
    expect(occurrences[1].date.getTime() - t0).toBe(7 * DAY)
    expect(occurrences[3].date.getTime() - t0).toBe(21 * DAY)
  })

  it('preserva a duração (endDate - date) em cada ocorrência', async () => {
    const author = await makeUser({ isPremium: true })
    const date = new Date(Date.now() + DAY)
    const endDate = new Date(date.getTime() + 2 * 3600_000) // 2h

    const res = await app.inject({
      method: 'POST',
      url: '/events',
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: baseEventBody({
        date: date.toISOString(),
        endDate: endDate.toISOString(),
        recurrence: { frequency: 'WEEKLY', count: 3 },
      }),
    })

    expect(res.statusCode).toBe(201)
    const occurrences = await testPrisma.event.findMany({
      where: { seriesId: res.json().seriesId },
      orderBy: { date: 'asc' },
    })
    for (const o of occurrences) {
      expect(o.endDate).not.toBeNull()
      expect((o.endDate as Date).getTime() - o.date.getTime()).toBe(
        2 * 3600_000,
      )
    }
  })

  it('MONTHLY no dia 31 faz clamp para fevereiro', async () => {
    const author = await makeUser({ isPremium: true })
    const date = new Date('2026-01-31T20:00:00Z')

    const res = await app.inject({
      method: 'POST',
      url: '/events',
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: baseEventBody({
        date: date.toISOString(),
        recurrence: { frequency: 'MONTHLY', count: 2 },
      }),
    })

    expect(res.statusCode).toBe(201)
    const occurrences = await testPrisma.event.findMany({
      where: { seriesId: res.json().seriesId },
      orderBy: { date: 'asc' },
    })
    expect(occurrences).toHaveLength(2)
    expect(occurrences[1].date.toISOString()).toBe('2026-02-28T20:00:00.000Z')
  })

  it('não-premium COM recurrence → 403', async () => {
    const author = await makeUser({ isPremium: false })
    const res = await app.inject({
      method: 'POST',
      url: '/events',
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: baseEventBody({ recurrence: { frequency: 'WEEKLY', count: 3 } }),
    })
    expect(res.statusCode).toBe(403)
  })

  it('REGRESSÃO: não-premium SEM recurrence → 201 (evento normal segue grátis)', async () => {
    const author = await makeUser({ isPremium: false })
    const res = await app.inject({
      method: 'POST',
      url: '/events',
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: baseEventBody(),
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().seriesId).toBeNull()
  })

  it('until + count juntos → 400', async () => {
    const author = await makeUser({ isPremium: true })
    const date = new Date(Date.now() + DAY)
    const res = await app.inject({
      method: 'POST',
      url: '/events',
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: baseEventBody({
        date: date.toISOString(),
        recurrence: {
          frequency: 'WEEKLY',
          until: new Date(date.getTime() + 30 * DAY).toISOString(),
          count: 4,
        },
      }),
    })
    expect(res.statusCode).toBe(400)
  })

  it('until mais de 1 ano após date → 400', async () => {
    const author = await makeUser({ isPremium: true })
    const date = new Date(Date.now() + DAY)
    const res = await app.inject({
      method: 'POST',
      url: '/events',
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: baseEventBody({
        date: date.toISOString(),
        recurrence: {
          frequency: 'WEEKLY',
          until: new Date(date.getTime() + 400 * DAY).toISOString(),
        },
      }),
    })
    expect(res.statusCode).toBe(400)
  })

  it('interval > 12 → 400', async () => {
    const author = await makeUser({ isPremium: true })
    const res = await app.inject({
      method: 'POST',
      url: '/events',
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: baseEventBody({
        recurrence: { frequency: 'WEEKLY', interval: 13 },
      }),
    })
    expect(res.statusCode).toBe(400)
  })

  it('until antes da data do evento → 400 (não 500)', async () => {
    const author = await makeUser({ isPremium: true })
    const date = new Date(Date.now() + DAY)
    const res = await app.inject({
      method: 'POST',
      url: '/events',
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: baseEventBody({
        date: date.toISOString(),
        recurrence: {
          frequency: 'WEEKLY',
          until: new Date(date.getTime() - 7 * DAY).toISOString(),
        },
      }),
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('DELETE /events/series/:seriesId', () => {
  it('cancela a série e as ocorrências futuras, preserva as passadas', async () => {
    const author = await makeUser({ isPremium: true })
    const series = await makeEventSeries(author.id, { frequency: 'WEEKLY' })
    const past = await makeEvent(author.id, {
      seriesId: series.id,
      date: new Date(Date.now() - 7 * DAY),
    })
    const future = await makeEvent(author.id, {
      seriesId: series.id,
      date: new Date(Date.now() + 7 * DAY),
    })

    const res = await app.inject({
      method: 'DELETE',
      url: `/events/series/${series.id}`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })

    expect(res.statusCode).toBe(204)
    const reloadedSeries = await testPrisma.eventSeries.findUnique({
      where: { id: series.id },
    })
    expect(reloadedSeries?.canceledAt).not.toBeNull()
    const reloadedFuture = await testPrisma.event.findUnique({
      where: { id: future.id },
    })
    expect(reloadedFuture?.canceledAt).not.toBeNull()
    const reloadedPast = await testPrisma.event.findUnique({
      where: { id: past.id },
    })
    expect(reloadedPast?.canceledAt).toBeNull()
  })

  it('autor que perdeu premium ainda pode cancelar a série', async () => {
    const author = await makeUser({ isPremium: false })
    const series = await makeEventSeries(author.id)
    await makeEvent(author.id, {
      seriesId: series.id,
      date: new Date(Date.now() + 7 * DAY),
    })

    const res = await app.inject({
      method: 'DELETE',
      url: `/events/series/${series.id}`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })
    expect(res.statusCode).toBe(204)
  })

  it('403 quando não é o autor da série', async () => {
    const author = await makeUser({ isPremium: true })
    const other = await makeUser({ isPremium: true })
    const series = await makeEventSeries(author.id)

    const res = await app.inject({
      method: 'DELETE',
      url: `/events/series/${series.id}`,
      headers: { authorization: `Bearer ${token(app, other.id)}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('404 quando a série não existe', async () => {
    const user = await makeUser({ isPremium: true })
    const res = await app.inject({
      method: 'DELETE',
      url: '/events/series/00000000-0000-0000-0000-000000000000',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })
    expect(res.statusCode).toBe(404)
  })

  it('409 quando a série já está cancelada', async () => {
    const author = await makeUser({ isPremium: true })
    const series = await makeEventSeries(author.id, { canceledAt: new Date() })

    const res = await app.inject({
      method: 'DELETE',
      url: `/events/series/${series.id}`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })
    expect(res.statusCode).toBe(409)
  })
})

describe('reconcileRecurringSeries (reposição de horizonte)', () => {
  it('repõe ocorrências futuras de série rolling até o novo horizonte', async () => {
    const author = await makeUser({ isPremium: true })
    const start = new Date('2026-06-01T20:00:00Z')
    const series = await makeEventSeries(author.id, { frequency: 'WEEKLY' })
    // Só 2 ocorrências materializadas (start e start+7d) — bem aquém do horizonte.
    await makeEvent(author.id, { seriesId: series.id, date: start })
    await makeEvent(author.id, {
      seriesId: series.id,
      date: new Date(start.getTime() + 7 * DAY),
    })

    const before = await testPrisma.event.count({
      where: { seriesId: series.id },
    })
    expect(before).toBe(2)

    // now = start + 7d → horizonte vai até start+97d, deve repor várias semanas.
    await reconcileRecurringSeries(new Date(start.getTime() + 7 * DAY))

    const after = await testPrisma.event.count({
      where: { seriesId: series.id },
    })
    expect(after).toBeGreaterThan(before)
    expect(after).toBeLessThanOrEqual(52)
  })

  it('ocorrências repostas herdam as subcategorias do template', async () => {
    const author = await makeUser({ isPremium: true })
    const start = new Date('2026-06-01T20:00:00Z')
    const series = await makeEventSeries(author.id, {
      frequency: 'WEEKLY',
      categories: ['PARTY'],
      subcategories: ['PARTY_BALADA'],
    })
    await makeEvent(author.id, {
      seriesId: series.id,
      date: start,
      subcategories: ['PARTY_BALADA'],
    })

    await reconcileRecurringSeries(new Date(start.getTime() + 7 * DAY))

    // As ocorrências geradas (posteriores à âncora) clonam do template da série.
    const replenished = await testPrisma.event.findMany({
      where: { seriesId: series.id, date: { gt: start } },
      select: { subcategories: true },
    })
    expect(replenished.length).toBeGreaterThan(0)
    for (const occ of replenished) {
      expect(occ.subcategories).toEqual(['PARTY_BALADA'])
    }
  })

  it('é idempotente: rodar duas vezes não duplica ocorrências', async () => {
    const author = await makeUser({ isPremium: true })
    const start = new Date('2026-06-01T20:00:00Z')
    const series = await makeEventSeries(author.id, { frequency: 'WEEKLY' })
    await makeEvent(author.id, { seriesId: series.id, date: start })

    const now = new Date(start.getTime() + 7 * DAY)
    await reconcileRecurringSeries(now)
    const afterFirst = await testPrisma.event.count({
      where: { seriesId: series.id },
    })
    await reconcileRecurringSeries(now)
    const afterSecond = await testPrisma.event.count({
      where: { seriesId: series.id },
    })
    expect(afterSecond).toBe(afterFirst)
  })

  it('não repõe série cancelada', async () => {
    const author = await makeUser({ isPremium: true })
    const start = new Date('2026-06-01T20:00:00Z')
    const series = await makeEventSeries(author.id, {
      frequency: 'WEEKLY',
      canceledAt: new Date(),
    })
    await makeEvent(author.id, { seriesId: series.id, date: start })

    await reconcileRecurringSeries(new Date(start.getTime() + 7 * DAY))
    const count = await testPrisma.event.count({
      where: { seriesId: series.id },
    })
    expect(count).toBe(1)
  })

  it('não repõe série de autor que perdeu premium', async () => {
    const author = await makeUser({ isPremium: false })
    const start = new Date('2026-06-01T20:00:00Z')
    const series = await makeEventSeries(author.id, { frequency: 'WEEKLY' })
    await makeEvent(author.id, { seriesId: series.id, date: start })

    await reconcileRecurringSeries(new Date(start.getTime() + 7 * DAY))
    const count = await testPrisma.event.count({
      where: { seriesId: series.id },
    })
    expect(count).toBe(1)
  })

  it('clona do TEMPLATE da série — editar uma ocorrência NÃO propaga', async () => {
    const author = await makeUser({ isPremium: true })
    const start = new Date('2026-06-01T20:00:00Z')
    // Template da série = 'Original' / categoria SPORTS.
    const series = await makeEventSeries(author.id, {
      frequency: 'WEEKLY',
      title: 'Original',
      category: 'SPORTS',
    })
    await makeEvent(author.id, {
      seriesId: series.id,
      date: start,
      title: 'Original',
      category: 'SPORTS',
    })
    const last = await makeEvent(author.id, {
      seriesId: series.id,
      date: new Date(start.getTime() + 7 * DAY),
      title: 'Original',
      category: 'SPORTS',
    })
    // Edição pontual da ocorrência mais recente.
    await testPrisma.event.update({
      where: { id: last.id },
      data: { title: 'EDITADO', categories: ['NIGHTLIFE'] },
    })

    await reconcileRecurringSeries(new Date(start.getTime() + 7 * DAY))

    const generated = await testPrisma.event.findMany({
      where: {
        seriesId: series.id,
        date: { gt: new Date(start.getTime() + 7 * DAY) },
      },
    })
    expect(generated.length).toBeGreaterThan(0)
    // As geradas seguem o TEMPLATE da série, não a edição da ocorrência.
    for (const g of generated) {
      expect(g.title).toBe('Original')
      expect(g.categories).toEqual(['SPORTS'])
    }
  })

  it('preserva durationMs do template ao gerar (endDate por ocorrência)', async () => {
    const author = await makeUser({ isPremium: true })
    const start = new Date('2026-06-01T20:00:00Z')
    const series = await makeEventSeries(author.id, {
      frequency: 'WEEKLY',
      durationMs: 2 * 3600_000, // 2h
    })
    await makeEvent(author.id, { seriesId: series.id, date: start })

    await reconcileRecurringSeries(new Date(start.getTime() + 7 * DAY))

    const generated = await testPrisma.event.findMany({
      where: { seriesId: series.id, date: { gt: start } },
    })
    expect(generated.length).toBeGreaterThan(0)
    for (const g of generated) {
      expect(g.endDate).not.toBeNull()
      expect((g.endDate as Date).getTime() - g.date.getTime()).toBe(
        2 * 3600_000,
      )
    }
  })
})
