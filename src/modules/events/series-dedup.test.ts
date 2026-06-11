import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import { makeEvent, makeEventSeries, makeUser } from '../../test/factories'
import { testPrisma } from '../../test/prisma'

let app: FastifyInstance

function token(app: FastifyInstance, userId: string) {
  return app.jwt.sign({ sub: userId })
}

const DAY = 86_400_000
const BBOX_IN = 'bboxNorth=-25.3&bboxSouth=-25.5&bboxEast=-49.2&bboxWest=-49.4'

async function makeSeriesWith(
  authorId: string,
  offsetsDays: number[],
  overrides: { title?: string } = {},
) {
  const series = await makeEventSeries(authorId, { title: overrides.title })
  for (const d of offsetsDays) {
    await makeEvent(authorId, {
      seriesId: series.id,
      latitude: -25.4,
      longitude: -49.3,
      date: new Date(Date.now() + d * DAY),
      title: overrides.title ?? `Série ${series.id}`,
    })
  }
  return series
}

beforeAll(async () => {
  app = buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await testPrisma.$disconnect()
})

describe('dedup de série nas listagens', () => {
  it('map colapsa a série em 1 ponto; avulso não colapsa', async () => {
    const author = await makeUser()
    await makeSeriesWith(author.id, [1, 8, 15])
    await makeEvent(author.id, {
      latitude: -25.41,
      longitude: -49.31,
      date: new Date(Date.now() + DAY),
    })

    const res = await app.inject({
      method: 'GET',
      url: `/events/map?${BBOX_IN}`,
    })

    expect(res.statusCode).toBe(200)
    // 1 representante da série + 1 avulso.
    expect(res.json().length).toBe(2)
  })

  it('viewport colapsa a série em 1 ocorrência', async () => {
    const author = await makeUser()
    const viewer = await makeUser()
    const series = await makeSeriesWith(author.id, [1, 8, 15])
    await makeEvent(author.id, {
      latitude: -25.4,
      longitude: -49.3,
      date: new Date(Date.now() + DAY),
    })

    const res = await app.inject({
      method: 'GET',
      url: `/events/map/events?${BBOX_IN}`,
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.statusCode).toBe(200)
    const data = res.json().data as { seriesId: string | null }[]
    expect(data.filter((e) => e.seriesId === series.id)).toHaveLength(1)
    expect(data.filter((e) => e.seriesId === null)).toHaveLength(1)
  })

  it('viewport: truncated reflete a contagem pós-colapso', async () => {
    const author = await makeUser()
    const viewer = await makeUser()
    await makeSeriesWith(author.id, [1, 8, 15])
    await makeSeriesWith(author.id, [2, 9, 16])

    const res = await app.inject({
      method: 'GET',
      url: `/events/map/events?${BBOX_IN}&limit=1`,
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    // 2 séries → 2 representativos > limit 1.
    expect(body.data).toHaveLength(1)
    expect(body.truncated).toBe(true)
  })

  it('busca retorna 1 ocorrência por série', async () => {
    const author = await makeUser()
    const series = await makeSeriesWith(author.id, [1, 8, 15], {
      title: 'Workshop de Ceramica',
    })

    const res = await app.inject({
      method: 'GET',
      url: '/events/search?q=Ceramica',
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })

    expect(res.statusCode).toBe(200)
    const data = res.json().data as { seriesId: string | null }[]
    expect(data.filter((e) => e.seriesId === series.id)).toHaveLength(1)
  })

  it('REGRESSÃO: feed GET /events NÃO colapsa séries', async () => {
    const author = await makeUser()
    const series = await makeSeriesWith(author.id, [1, 8, 15])

    const res = await app.inject({ method: 'GET', url: '/events?limit=50' })

    expect(res.statusCode).toBe(200)
    const data = res.json().data as { seriesId: string | null }[]
    expect(data.filter((e) => e.seriesId === series.id)).toHaveLength(3)
  })
})
