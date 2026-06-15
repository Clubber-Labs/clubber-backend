import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import {
  makeEvent,
  makeEventImage,
  makeEventSeries,
  makeUser,
} from '../../test/factories'
import { testPrisma } from '../../test/prisma'

let app: FastifyInstance

function token(app: FastifyInstance, userId: string) {
  return app.jwt.sign({ sub: userId })
}

const DAY = 86_400_000
// bbox em torno do lat/lng default das factories (-25.4, -49.3).
const BBOX_IN = 'bboxNorth=-25.3&bboxSouth=-25.5&bboxEast=-49.2&bboxWest=-49.4'

beforeAll(async () => {
  app = buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await testPrisma.$disconnect()
})

describe('fallback de imagem por série', () => {
  it('ocorrência sem imagem herda as imagens da âncora (GET /events/:id)', async () => {
    const author = await makeUser()
    const series = await makeEventSeries(author.id)
    const anchor = await makeEvent(author.id, {
      seriesId: series.id,
      date: new Date(Date.now() - 7 * DAY),
    })
    await makeEventImage(anchor.id, {
      url: 'https://cdn.test/anchor.webp',
      order: 0,
    })
    const future = await makeEvent(author.id, {
      seriesId: series.id,
      date: new Date(Date.now() + 7 * DAY),
    })

    const res = await app.inject({ method: 'GET', url: `/events/${future.id}` })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.images).toHaveLength(1)
    expect(body.images[0].url).toBe('https://cdn.test/anchor.webp')
  })

  it('ocorrência COM imagem própria não herda', async () => {
    const author = await makeUser()
    const series = await makeEventSeries(author.id)
    const anchor = await makeEvent(author.id, {
      seriesId: series.id,
      date: new Date(Date.now() - 7 * DAY),
    })
    await makeEventImage(anchor.id, { url: 'https://cdn.test/anchor.webp' })
    const future = await makeEvent(author.id, {
      seriesId: series.id,
      date: new Date(Date.now() + 7 * DAY),
    })
    await makeEventImage(future.id, { url: 'https://cdn.test/propria.webp' })

    const res = await app.inject({ method: 'GET', url: `/events/${future.id}` })

    expect(res.statusCode).toBe(200)
    expect(res.json().images).toHaveLength(1)
    expect(res.json().images[0].url).toBe('https://cdn.test/propria.webp')
  })

  it('evento avulso (seriesId null) sem imagem fica com images vazio', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id)

    const res = await app.inject({ method: 'GET', url: `/events/${event.id}` })

    expect(res.statusCode).toBe(200)
    expect(res.json().images).toEqual([])
  })

  it('listagem (viewport) aplica o fallback batched', async () => {
    const author = await makeUser()
    const viewer = await makeUser()
    const series = await makeEventSeries(author.id)
    const anchor = await makeEvent(author.id, {
      seriesId: series.id,
      date: new Date(Date.now() - 7 * DAY),
    })
    await makeEventImage(anchor.id, { url: 'https://cdn.test/anchor.webp' })
    const future = await makeEvent(author.id, {
      seriesId: series.id,
      date: new Date(Date.now() + 7 * DAY),
    })

    const res = await app.inject({
      method: 'GET',
      url: `/events/map/events?${BBOX_IN}`,
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.statusCode).toBe(200)
    const found = res
      .json()
      .data.find((e: { id: string }) => e.id === future.id)
    expect(found).toBeDefined()
    expect(found.images).toHaveLength(1)
    expect(found.images[0].url).toBe('https://cdn.test/anchor.webp')
  })
})
