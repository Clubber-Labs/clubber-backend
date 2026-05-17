import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { redis as nullableRedis } from '../../lib/redis'
import { buildApp } from '../../test/app'
import { makeAttendance, makeEvent, makeInvite, makeUser } from '../../test/factories'
import { fakeStorage } from '../../test/fake-storage'
import { multipartFormData, tinyPngBuffer } from '../../test/image-fixture'
import { testPrisma } from '../../test/prisma'

if (!nullableRedis) {
  throw new Error(
    'REDIS_URL deve estar configurada em .env.test para esses testes',
  )
}

const redis = nullableRedis

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

  it('filtra por múltiplas categorias (?category=A&category=B)', async () => {
    const user = await makeUser()
    await makeEvent(user.id, { category: 'Festa', isPublic: true })
    await makeEvent(user.id, { category: 'Show', isPublic: true })
    await makeEvent(user.id, { category: 'Esporte', isPublic: true })

    const res = await app.inject({
      method: 'GET',
      url: '/events?category=Festa&category=Show',
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    const categorias = body.data.map((e: { category: string }) => e.category)
    expect(categorias).toEqual(expect.arrayContaining(['Festa', 'Show']))
    expect(categorias).not.toContain('Esporte')
  })

  it('ignora category vazia e não filtra', async () => {
    const user = await makeUser()
    await makeEvent(user.id, { category: 'Festa', isPublic: true })
    await makeEvent(user.id, { category: 'Show', isPublic: true })

    const res = await app.inject({ method: 'GET', url: '/events?category=' })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.length).toBe(2)
  })

  it('por padrão esconde eventos passados (endDate < now)', async () => {
    const user = await makeUser()
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const pastEnd = new Date(Date.now() - 12 * 60 * 60 * 1000)
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000)
    await makeEvent(user.id, { date: past, endDate: pastEnd, isPublic: true })
    await makeEvent(user.id, { date: future, isPublic: true })

    const res = await app.inject({ method: 'GET', url: '/events' })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data.length).toBe(1)
    expect(new Date(body.data[0].date).getTime()).toBeGreaterThan(Date.now())
  })

  it('?includePast=true retorna eventos passados', async () => {
    const user = await makeUser()
    const past = new Date(Date.now() - 48 * 60 * 60 * 1000)
    const pastEnd = new Date(Date.now() - 24 * 60 * 60 * 1000)
    await makeEvent(user.id, { date: past, endDate: pastEnd, isPublic: true })

    const res = await app.inject({
      method: 'GET',
      url: '/events?includePast=true',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.length).toBe(1)
  })

  it('por padrão esconde eventos cancelados', async () => {
    const user = await makeUser()
    await makeEvent(user.id, { isPublic: true })
    await makeEvent(user.id, { isPublic: true, canceledAt: new Date() })

    const res = await app.inject({ method: 'GET', url: '/events' })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.length).toBe(1)
  })

  it('?status=CANCELED retorna apenas cancelados', async () => {
    const user = await makeUser()
    await makeEvent(user.id, { isPublic: true })
    await makeEvent(user.id, { isPublic: true, canceledAt: new Date() })

    const res = await app.inject({
      method: 'GET',
      url: '/events?status=CANCELED',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.length).toBe(1)
    expect(res.json().data[0].canceledAt).not.toBeNull()
  })

  it('?status=ONGOING filtra eventos em andamento', async () => {
    const user = await makeUser()
    const start = new Date(Date.now() - 30 * 60 * 1000)
    const end = new Date(Date.now() + 30 * 60 * 1000)
    await makeEvent(user.id, { date: start, endDate: end, isPublic: true })
    await makeEvent(user.id, {
      date: new Date(Date.now() + 24 * 60 * 60 * 1000),
      isPublic: true,
    })

    const res = await app.inject({
      method: 'GET',
      url: '/events?status=ONGOING',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.length).toBe(1)
    expect(res.json().data[0].status).toBe('ONGOING')
  })

  it('cada evento retorna o campo status computado', async () => {
    const user = await makeUser()
    await makeEvent(user.id, {
      date: new Date(Date.now() + 30 * 60 * 1000),
      isPublic: true,
    })

    const res = await app.inject({ method: 'GET', url: '/events' })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data[0]).toHaveProperty('status')
    expect(['SOON', 'ONGOING', 'UPCOMING']).toContain(body.data[0].status)
  })

  it('filtra por radiusKm quando nearLat/nearLng informados', async () => {
    const user = await makeUser()
    // Curitiba (-25.4, -49.3)
    await makeEvent(user.id, {
      latitude: -25.4,
      longitude: -49.3,
      isPublic: true,
    })
    // São Paulo (-23.5, -46.6) ~400km de Curitiba
    await makeEvent(user.id, {
      latitude: -23.5,
      longitude: -46.6,
      isPublic: true,
    })

    const res = await app.inject({
      method: 'GET',
      url: '/events?nearLat=-25.4&nearLng=-49.3&radiusKm=50',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.length).toBe(1)
  })

  it('?status=CANCELED combinado com radiusKm retorna cancelados próximos', async () => {
    const user = await makeUser()
    await makeEvent(user.id, {
      latitude: -25.4,
      longitude: -49.3,
      isPublic: true,
      canceledAt: new Date(),
    })

    const res = await app.inject({
      method: 'GET',
      url: '/events?nearLat=-25.4&nearLng=-49.3&radiusKm=50&status=CANCELED',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.length).toBe(1)
    expect(res.json().data[0].canceledAt).not.toBeNull()
  })

  it('orderBy=distance ordena pela proximidade', async () => {
    const user = await makeUser()
    const farId = (
      await makeEvent(user.id, {
        latitude: -23.5,
        longitude: -46.6,
        isPublic: true,
      })
    ).id
    const nearId = (
      await makeEvent(user.id, {
        latitude: -25.4,
        longitude: -49.3,
        isPublic: true,
      })
    ).id

    const res = await app.inject({
      method: 'GET',
      url: '/events?nearLat=-25.4&nearLng=-49.3&orderBy=distance',
    })

    expect(res.statusCode).toBe(200)
    const ids = res.json().data.map((e: { id: string }) => e.id)
    expect(ids[0]).toBe(nearId)
    expect(ids[1]).toBe(farId)
  })

  it('retorna 400 se radiusKm sem nearLat/nearLng', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/events?radiusKm=10',
    })

    expect(res.statusCode).toBe(400)
  })

  it('retorna 400 quando orderBy=distance combinado com cursor', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/events?nearLat=-25.4&nearLng=-49.3&orderBy=distance&cursor=00000000-0000-0000-0000-000000000000',
    })

    expect(res.statusCode).toBe(400)
  })

  it('orderBy=distance respeita radiusKm quando combinados', async () => {
    const user = await makeUser()
    const inside = await makeEvent(user.id, {
      latitude: -25.4,
      longitude: -49.3,
      isPublic: true,
    })
    await makeEvent(user.id, {
      latitude: -23.5,
      longitude: -46.6,
      isPublic: true,
    })

    const res = await app.inject({
      method: 'GET',
      url: '/events?nearLat=-25.4&nearLng=-49.3&radiusKm=50&orderBy=distance',
    })

    expect(res.statusCode).toBe(200)
    const ids = res.json().data.map((e: { id: string }) => e.id)
    expect(ids).toEqual([inside.id])
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
      userLiked: false,
      userAttendance: null,
    })
  })
})

describe('cache de GET /events', () => {
  it('reage não invalida o cache da listagem pública', async () => {
    const author = await makeUser()
    const viewer = await makeUser()
    const event = await makeEvent(author.id, { isPublic: true })

    await app.inject({ method: 'GET', url: '/events' })

    const beforeKeys = await redis.keys('v1:events:public:*')
    expect(beforeKeys.length).toBeGreaterThan(0)

    const reactRes = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/reactions`,
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })
    expect(reactRes.statusCode).toBe(201)

    const afterKeys = await redis.keys('v1:events:public:*')
    expect(afterKeys).toEqual(beforeKeys)
  })

  it('confirmar presença não invalida o cache da listagem pública', async () => {
    const author = await makeUser()
    const viewer = await makeUser()
    const event = await makeEvent(author.id, { isPublic: true })

    await app.inject({ method: 'GET', url: '/events' })

    const beforeKeys = await redis.keys('v1:events:public:*')
    expect(beforeKeys.length).toBeGreaterThan(0)

    const attRes = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/attendances`,
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
      body: { type: 'CONFIRMED' },
    })
    expect(attRes.statusCode).toBe(201)

    const afterKeys = await redis.keys('v1:events:public:*')
    expect(afterKeys).toEqual(beforeKeys)
  })

  it('viewer state vem de overlay (uma única chave compartilhada para múltiplos viewers)', async () => {
    const author = await makeUser()
    const viewerA = await makeUser()
    const viewerB = await makeUser()
    const event = await makeEvent(author.id, { isPublic: true })

    await testPrisma.reaction.create({
      data: { userId: viewerA.id, eventId: event.id },
    })

    const resA = await app.inject({
      method: 'GET',
      url: '/events',
      headers: { authorization: `Bearer ${token(app, viewerA.id)}` },
    })
    expect(resA.statusCode).toBe(200)
    const eventA = resA
      .json()
      .data.find((e: { id: string }) => e.id === event.id)
    expect(eventA.userLiked).toBe(true)

    const resB = await app.inject({
      method: 'GET',
      url: '/events',
      headers: { authorization: `Bearer ${token(app, viewerB.id)}` },
    })
    expect(resB.statusCode).toBe(200)
    const eventB = resB
      .json()
      .data.find((e: { id: string }) => e.id === event.id)
    expect(eventB.userLiked).toBe(false)

    const keys = await redis.keys('v1:events:public:*')
    expect(keys).toHaveLength(1)
  })

  it('criar evento invalida o cache (lista muda)', async () => {
    const author = await makeUser()
    await makeEvent(author.id, { isPublic: true })

    await app.inject({ method: 'GET', url: '/events' })
    expect((await redis.keys('v1:events:public:*')).length).toBeGreaterThan(0)

    await app.inject({
      method: 'POST',
      url: '/events',
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: {
        title: 'Novo evento',
        description: 'Descrição do evento',
        date: new Date(Date.now() + 86400000).toISOString(),
        latitude: -25.4,
        longitude: -49.3,
        category: 'Festa',
        isPublic: true,
      },
    })

    expect(await redis.keys('v1:events:public:*')).toHaveLength(0)
  })
})

describe('GET /events/map', () => {
  it('UPCOMING distante: peso vem só do engajamento', async () => {
    const author = await makeUser()
    const u1 = await makeUser()
    const u2 = await makeUser()
    const u3 = await makeUser()
    const event = await makeEvent(author.id, {
      latitude: -25.4,
      longitude: -49.3,
      isPublic: true,
      // UPCOMING (>48h): sem boost de status
      date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })
    await makeAttendance(u1.id, event.id, 'CONFIRMED')
    await makeAttendance(u2.id, event.id, 'CONFIRMED')
    await makeAttendance(u3.id, event.id, 'INTERESTED')

    const res = await app.inject({
      method: 'GET',
      url: '/events/map?bboxNorth=-25.3&bboxSouth=-25.5&bboxEast=-49.2&bboxWest=-49.4',
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.length).toBe(1)
    expect(body[0]).toMatchObject({
      id: event.id,
      weight: 5, // 2*CONFIRMED + 1*INTERESTED + 0 (UPCOMING)
    })
  })

  it('ONGOING ganha boost de peso mesmo sem confirmados', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id, {
      latitude: -25.4,
      longitude: -49.3,
      isPublic: true,
      date: new Date(Date.now() - 30 * 60 * 1000),
      endDate: new Date(Date.now() + 30 * 60 * 1000),
    })

    const res = await app.inject({
      method: 'GET',
      url: '/events/map?bboxNorth=-25.3&bboxSouth=-25.5&bboxEast=-49.2&bboxWest=-49.4',
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.length).toBe(1)
    expect(body[0]).toMatchObject({ id: event.id, weight: 20 })
  })

  it('ONGOING: engajamento + boost', async () => {
    const author = await makeUser()
    const u1 = await makeUser()
    const u2 = await makeUser()
    const event = await makeEvent(author.id, {
      latitude: -25.4,
      longitude: -49.3,
      isPublic: true,
      date: new Date(Date.now() - 30 * 60 * 1000),
      endDate: new Date(Date.now() + 30 * 60 * 1000),
    })
    await makeAttendance(u1.id, event.id, 'CONFIRMED')
    await makeAttendance(u2.id, event.id, 'CONFIRMED')

    const res = await app.inject({
      method: 'GET',
      url: '/events/map?bboxNorth=-25.3&bboxSouth=-25.5&bboxEast=-49.2&bboxWest=-49.4',
    })

    const body = res.json()
    expect(body[0]).toMatchObject({ id: event.id, weight: 24 }) // 4 + 20
  })

  it('SOON ganha boost menor que ONGOING', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id, {
      latitude: -25.4,
      longitude: -49.3,
      isPublic: true,
      // SOON: dentro de 48h
      date: new Date(Date.now() + 12 * 60 * 60 * 1000),
    })

    const res = await app.inject({
      method: 'GET',
      url: '/events/map?bboxNorth=-25.3&bboxSouth=-25.5&bboxEast=-49.2&bboxWest=-49.4',
    })

    const body = res.json()
    expect(body[0]).toMatchObject({ id: event.id, weight: 5 }) // 0 engajamento + 5 SOON
  })

  it('eventos fora do bbox não aparecem', async () => {
    const author = await makeUser()
    await makeEvent(author.id, {
      latitude: -25.4,
      longitude: -49.3,
      isPublic: true,
    })

    const res = await app.inject({
      method: 'GET',
      url: '/events/map?bboxNorth=-23.4&bboxSouth=-23.6&bboxEast=-46.5&bboxWest=-46.7',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
  })

  it('eventos privados não aparecem no mapa', async () => {
    const author = await makeUser()
    await makeEvent(author.id, {
      latitude: -25.4,
      longitude: -49.3,
      isPublic: false,
    })

    const res = await app.inject({
      method: 'GET',
      url: '/events/map?bboxNorth=-25.3&bboxSouth=-25.5&bboxEast=-49.2&bboxWest=-49.4',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
  })

  it('retorna 400 quando bbox malformado (north <= south)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/events/map?bboxNorth=-25.5&bboxSouth=-25.3&bboxEast=-49.2&bboxWest=-49.4',
    })

    expect(res.statusCode).toBe(400)
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

  it('aceita endDate posterior a date', async () => {
    const user = await makeUser()
    const start = new Date(Date.now() + 86400000)
    const end = new Date(start.getTime() + 4 * 60 * 60 * 1000)

    const res = await app.inject({
      method: 'POST',
      url: '/events',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: {
        title: 'Evento com fim',
        description: 'Tem hora pra acabar',
        date: start.toISOString(),
        endDate: end.toISOString(),
        latitude: -25.4,
        longitude: -49.3,
        category: 'Festa',
        isPublic: true,
      },
    })

    expect(res.statusCode).toBe(201)
    expect(new Date(res.json().endDate).getTime()).toBe(end.getTime())
  })

  it('retorna 400 quando latitude fora de [-90, 90]', async () => {
    const user = await makeUser()
    const res = await app.inject({
      method: 'POST',
      url: '/events',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: {
        title: 'Inválido',
        description: 'Descrição completa',
        date: new Date(Date.now() + 86400000).toISOString(),
        latitude: 200,
        longitude: -49.3,
        category: 'Festa',
        isPublic: true,
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('retorna 400 quando longitude fora de [-180, 180]', async () => {
    const user = await makeUser()
    const res = await app.inject({
      method: 'POST',
      url: '/events',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: {
        title: 'Inválido',
        description: 'Descrição completa',
        date: new Date(Date.now() + 86400000).toISOString(),
        latitude: -25.4,
        longitude: 200,
        category: 'Festa',
        isPublic: true,
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('retorna 400 se endDate <= date', async () => {
    const user = await makeUser()
    const start = new Date(Date.now() + 86400000)
    const end = new Date(start.getTime() - 60 * 60 * 1000)

    const res = await app.inject({
      method: 'POST',
      url: '/events',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: {
        title: 'Inválido',
        description: 'Desc completa aqui',
        date: start.toISOString(),
        endDate: end.toISOString(),
        latitude: -25.4,
        longitude: -49.3,
        category: 'Festa',
        isPublic: true,
      },
    })

    expect(res.statusCode).toBe(400)
  })
})

describe('PUT /events/:id', () => {
  it('retorna 400 ao atualizar só endDate para antes da date persistida', async () => {
    const user = await makeUser()
    const start = new Date(Date.now() + 86400000)
    const end = new Date(start.getTime() + 4 * 60 * 60 * 1000)

    const created = await app.inject({
      method: 'POST',
      url: '/events',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: {
        title: 'Evento original',
        description: 'Descrição completa',
        date: start.toISOString(),
        endDate: end.toISOString(),
        latitude: -25.4,
        longitude: -49.3,
        category: 'Festa',
        isPublic: true,
      },
    })
    const eventId = created.json().id
    const badEnd = new Date(start.getTime() - 60 * 60 * 1000)

    const res = await app.inject({
      method: 'PUT',
      url: `/events/${eventId}`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { endDate: badEnd.toISOString() },
    })

    expect(res.statusCode).toBe(400)
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
    const { body, contentType } = multipartFormData(
      png,
      'file',
      'capa.png',
      'image/png',
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

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ format: 'webp', eventId: event.id })
    expect(fakeStorage.uploads).toHaveLength(1)
    expect(fakeStorage.uploads[0].key).toContain(`events/${event.id}/`)

    const detail = await app.inject({
      method: 'GET',
      url: `/events/${event.id}`,
    })
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
    const { body, contentType } = multipartFormData(
      png,
      'file',
      'capa.png',
      'image/png',
    )

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
    const { body, contentType } = multipartFormData(
      png,
      'file',
      'capa.png',
      'image/png',
    )

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
