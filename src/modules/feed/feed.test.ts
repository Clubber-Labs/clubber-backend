import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import {
  makeAttendance,
  makeComment,
  makeEvent,
  makeFollow,
  makeInvite,
  makeReaction,
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

describe('GET /feed', () => {
  it('retorna eventos de quem o usuário segue', async () => {
    const viewer = await makeUser()
    const followed = await makeUser()
    await makeFollow(viewer.id, followed.id)
    await makeEvent(followed.id, { isPublic: true })

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.length).toBeGreaterThan(0)
  })

  it('retorna eventos onde seguidos têm presença', async () => {
    const viewer = await makeUser()
    const followed = await makeUser()
    const author = await makeUser()
    await makeFollow(viewer.id, followed.id)
    const event = await makeEvent(author.id, { isPublic: true })
    await makeAttendance(followed.id, event.id)

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.some((e: { id: string }) => e.id === event.id)).toBe(
      true,
    )
  })

  it('não exibe eventos privados sem acesso do viewer', async () => {
    const viewer = await makeUser()
    const followed = await makeUser()
    await makeFollow(viewer.id, followed.id)
    await makeEvent(followed.id, { isPublic: false })

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.statusCode).toBe(200)
    // Nenhum evento privado de followed deve aparecer (viewer não foi convidado)
    const hasPrivate = res
      .json()
      .data.some((e: { isPublic: boolean }) => !e.isPublic)
    expect(hasPrivate).toBe(false)
  })

  it('exibe evento privado se viewer for convidado', async () => {
    const viewer = await makeUser()
    const followed = await makeUser()
    await makeFollow(viewer.id, followed.id)
    const event = await makeEvent(followed.id, { isPublic: false })
    await makeInvite(event.id, followed.id, viewer.id)

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.some((e: { id: string }) => e.id === event.id)).toBe(
      true,
    )
  })

  it('exibe os próprios eventos mesmo sem seguir ninguém', async () => {
    const viewer = await makeUser()
    const event = await makeEvent(viewer.id, { isPublic: true })

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.some((e: { id: string }) => e.id === event.id)).toBe(
      true,
    )
  })

  it('retorna eventos onde seguido reagiu', async () => {
    const viewer = await makeUser()
    const followed = await makeUser()
    const author = await makeUser()
    await makeFollow(viewer.id, followed.id)
    const event = await makeEvent(author.id, { isPublic: true })
    await makeReaction(followed.id, event.id)

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.some((e: { id: string }) => e.id === event.id)).toBe(
      true,
    )
  })

  it('retorna eventos onde seguido comentou', async () => {
    const viewer = await makeUser()
    const followed = await makeUser()
    const author = await makeUser()
    await makeFollow(viewer.id, followed.id)
    const event = await makeEvent(author.id, { isPublic: true })
    await makeComment(followed.id, event.id)

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.some((e: { id: string }) => e.id === event.id)).toBe(
      true,
    )
  })

  it('retorna 401 sem autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: '/feed' })
    expect(res.statusCode).toBe(401)
  })
})

describe('GET /feed — status', () => {
  it('evento futuro vem com status UPCOMING ou SOON', async () => {
    const viewer = await makeUser()
    const event = await makeEvent(viewer.id, {
      isPublic: true,
      date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    const found = res.json().data.find((e: { id: string }) => e.id === event.id)
    expect(found).toBeDefined()
    expect(['UPCOMING', 'SOON']).toContain(found.status)
  })

  it('evento passado vem com status PAST', async () => {
    const viewer = await makeUser()
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const pastEnd = new Date(Date.now() - 12 * 60 * 60 * 1000)
    const event = await makeEvent(viewer.id, {
      isPublic: true,
      date: past,
      endDate: pastEnd,
    })

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    const found = res.json().data.find((e: { id: string }) => e.id === event.id)
    expect(found).toBeDefined()
    expect(found.status).toBe('PAST')
  })

  it('evento cancelado é escondido por default', async () => {
    const viewer = await makeUser()
    const event = await makeEvent(viewer.id, {
      isPublic: true,
      canceledAt: new Date(),
    })

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    const found = res.json().data.find((e: { id: string }) => e.id === event.id)
    expect(found).toBeUndefined()
  })

  it('?status=CANCELED retorna eventos cancelados com status CANCELED', async () => {
    const viewer = await makeUser()
    const event = await makeEvent(viewer.id, {
      isPublic: true,
      canceledAt: new Date(),
    })

    const res = await app.inject({
      method: 'GET',
      url: '/feed?status=CANCELED',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    const found = res.json().data.find((e: { id: string }) => e.id === event.id)
    expect(found).toBeDefined()
    expect(found.status).toBe('CANCELED')
  })
})

describe('GET /feed — filtros', () => {
  it('?status=ONGOING filtra apenas eventos em andamento', async () => {
    const viewer = await makeUser()
    const ongoingStart = new Date(Date.now() - 30 * 60 * 1000)
    const ongoingEnd = new Date(Date.now() + 30 * 60 * 1000)
    const ongoing = await makeEvent(viewer.id, {
      isPublic: true,
      date: ongoingStart,
      endDate: ongoingEnd,
    })
    const upcoming = await makeEvent(viewer.id, {
      isPublic: true,
      date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })

    const res = await app.inject({
      method: 'GET',
      url: '/feed?status=ONGOING',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    const ids = res.json().data.map((e: { id: string }) => e.id)
    expect(ids).toContain(ongoing.id)
    expect(ids).not.toContain(upcoming.id)
  })

  it('?includePast=false esconde eventos passados', async () => {
    const viewer = await makeUser()
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const pastEnd = new Date(Date.now() - 12 * 60 * 60 * 1000)
    const pastEvent = await makeEvent(viewer.id, {
      isPublic: true,
      date: past,
      endDate: pastEnd,
    })

    const res = await app.inject({
      method: 'GET',
      url: '/feed?includePast=false',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    const found = res
      .json()
      .data.find((e: { id: string }) => e.id === pastEvent.id)
    expect(found).toBeUndefined()
  })

  it('por default mostra eventos passados (contexto social)', async () => {
    const viewer = await makeUser()
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const pastEnd = new Date(Date.now() - 12 * 60 * 60 * 1000)
    const pastEvent = await makeEvent(viewer.id, {
      isPublic: true,
      date: past,
      endDate: pastEnd,
    })

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    const found = res
      .json()
      .data.find((e: { id: string }) => e.id === pastEvent.id)
    expect(found).toBeDefined()
    expect(found.status).toBe('PAST')
  })

  it('?category=Festa filtra por categoria', async () => {
    const viewer = await makeUser()
    const festa = await makeEvent(viewer.id, {
      isPublic: true,
      category: 'Festa',
    })
    const show = await makeEvent(viewer.id, {
      isPublic: true,
      category: 'Show',
    })

    const res = await app.inject({
      method: 'GET',
      url: '/feed?category=Festa',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    const ids = res.json().data.map((e: { id: string }) => e.id)
    expect(ids).toContain(festa.id)
    expect(ids).not.toContain(show.id)
  })

  it('?dateFrom/dateTo filtra por range de data', async () => {
    const viewer = await makeUser()
    const inRange = await makeEvent(viewer.id, {
      isPublic: true,
      date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    })
    const outOfRange = await makeEvent(viewer.id, {
      isPublic: true,
      date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    })

    const dateFrom = new Date(
      Date.now() + 1 * 24 * 60 * 60 * 1000,
    ).toISOString()
    const dateTo = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const res = await app.inject({
      method: 'GET',
      url: `/feed?dateFrom=${dateFrom}&dateTo=${dateTo}`,
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    const ids = res.json().data.map((e: { id: string }) => e.id)
    expect(ids).toContain(inRange.id)
    expect(ids).not.toContain(outOfRange.id)
  })
})

describe('GET /feed — ranking', () => {
  it('ONGOING ranqueia acima de UPCOMING distante', async () => {
    const viewer = await makeUser()
    const ongoing = await makeEvent(viewer.id, {
      isPublic: true,
      date: new Date(Date.now() - 30 * 60 * 1000),
      endDate: new Date(Date.now() + 30 * 60 * 1000),
    })
    const upcomingFar = await makeEvent(viewer.id, {
      isPublic: true,
      date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    })

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    const ids = res
      .json()
      .data.map((e: { id: string }) => e.id)
      .filter((id: string) => id === ongoing.id || id === upcomingFar.id)
    expect(ids).toEqual([ongoing.id, upcomingFar.id])
  })

  it('ONGOING sem confirmados ainda ranqueia acima de UPCOMING bem engajado', async () => {
    const viewer = await makeUser()
    const f1 = await makeUser()
    const f2 = await makeUser()
    const f3 = await makeUser()
    await makeFollow(viewer.id, f1.id)
    await makeFollow(viewer.id, f2.id)
    await makeFollow(viewer.id, f3.id)

    const ongoing = await makeEvent(viewer.id, {
      isPublic: true,
      date: new Date(Date.now() - 30 * 60 * 1000),
      endDate: new Date(Date.now() + 30 * 60 * 1000),
    })

    // UPCOMING distante mas com 3 amigos confirmando
    const popularUpcoming = await makeEvent(viewer.id, {
      isPublic: true,
      date: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    })
    await makeAttendance(f1.id, popularUpcoming.id, 'CONFIRMED')
    await makeAttendance(f2.id, popularUpcoming.id, 'CONFIRMED')
    await makeAttendance(f3.id, popularUpcoming.id, 'CONFIRMED')

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    const ids = res
      .json()
      .data.map((e: { id: string }) => e.id)
      .filter((id: string) => id === ongoing.id || id === popularUpcoming.id)
    expect(ids).toEqual([ongoing.id, popularUpcoming.id])
  })

  it('PAST distante ranqueia abaixo de UPCOMING', async () => {
    const viewer = await makeUser()
    const upcoming = await makeEvent(viewer.id, {
      isPublic: true,
      date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    })
    const pastEvent = await makeEvent(viewer.id, {
      isPublic: true,
      date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      endDate: new Date(
        Date.now() - 7 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000,
      ),
    })

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    const ids = res
      .json()
      .data.map((e: { id: string }) => e.id)
      .filter((id: string) => id === upcoming.id || id === pastEvent.id)
    expect(ids).toEqual([upcoming.id, pastEvent.id])
  })

  it('engagement de amigos eleva PAST acima de UPCOMING distante', async () => {
    const viewer = await makeUser()
    const f1 = await makeUser()
    const f2 = await makeUser()
    const f3 = await makeUser()
    await makeFollow(viewer.id, f1.id)
    await makeFollow(viewer.id, f2.id)
    await makeFollow(viewer.id, f3.id)

    const upcomingFar = await makeEvent(viewer.id, {
      isPublic: true,
      date: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    })

    const popularPast = await makeEvent(viewer.id, {
      isPublic: true,
      date: new Date(Date.now() - 6 * 60 * 60 * 1000),
      endDate: new Date(Date.now() - 2 * 60 * 60 * 1000),
    })
    await makeAttendance(f1.id, popularPast.id, 'CONFIRMED')
    await makeAttendance(f2.id, popularPast.id, 'CONFIRMED')
    await makeAttendance(f3.id, popularPast.id, 'CONFIRMED')

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    const ids = res
      .json()
      .data.map((e: { id: string }) => e.id)
      .filter((id: string) => id === popularPast.id || id === upcomingFar.id)
    expect(ids).toEqual([popularPast.id, upcomingFar.id])
  })

  it('categoria preferida eleva evento de mesma data', async () => {
    const viewer = await makeUser()
    // Histórico: viewer já participou de eventos de "Festa"
    const histAuthor = await makeUser()
    for (let i = 0; i < 3; i++) {
      const histEvent = await makeEvent(histAuthor.id, {
        isPublic: true,
        category: 'Festa',
      })
      await makeAttendance(viewer.id, histEvent.id, 'CONFIRMED')
    }

    const sameDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
    const author = await makeUser()
    const festa = await makeEvent(author.id, {
      isPublic: true,
      category: 'Festa',
      date: sameDate,
    })
    const show = await makeEvent(author.id, {
      isPublic: true,
      category: 'Show',
      date: sameDate,
    })
    // Trazer ambos pro feed via interação de amigo
    const friend = await makeUser()
    await makeFollow(viewer.id, friend.id)
    await makeAttendance(friend.id, festa.id, 'INTERESTED')
    await makeAttendance(friend.id, show.id, 'INTERESTED')

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    const ids = res
      .json()
      .data.map((e: { id: string }) => e.id)
      .filter((id: string) => id === festa.id || id === show.id)
    expect(ids).toEqual([festa.id, show.id])
  })

  it('NOT_INTERESTED de amigo não traz evento pro feed', async () => {
    const viewer = await makeUser()
    const friend = await makeUser()
    const author = await makeUser()
    await makeFollow(viewer.id, friend.id)
    const event = await makeEvent(author.id, { isPublic: true })
    await makeAttendance(friend.id, event.id, 'NOT_INTERESTED')

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    const found = res.json().data.find((e: { id: string }) => e.id === event.id)
    expect(found).toBeUndefined()
  })

  it('cursor pagina sem repetir eventos', async () => {
    const viewer = await makeUser()
    for (let i = 0; i < 6; i++) {
      await makeEvent(viewer.id, {
        isPublic: true,
        date: new Date(Date.now() + (i + 1) * 24 * 60 * 60 * 1000),
      })
    }

    const page1 = await app.inject({
      method: 'GET',
      url: '/feed?limit=3',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })
    const body1 = page1.json()
    expect(body1.data.length).toBe(3)
    expect(body1.nextCursor).toBeTruthy()

    const page2 = await app.inject({
      method: 'GET',
      url: `/feed?limit=3&cursor=${body1.nextCursor}`,
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })
    const body2 = page2.json()
    const ids1 = body1.data.map((e: { id: string }) => e.id)
    const ids2 = body2.data.map((e: { id: string }) => e.id)
    expect(ids1.some((id: string) => ids2.includes(id))).toBe(false)
  })

  it('cursor inválido retorna página vazia em vez de duplicar', async () => {
    const viewer = await makeUser()
    await makeEvent(viewer.id, { isPublic: true })

    const res = await app.inject({
      method: 'GET',
      url: '/feed?limit=3&cursor=00000000-0000-0000-0000-000000000000',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: [], nextCursor: null })
  })
})

describe('GET /feed — reason', () => {
  it('reason self_created para evento próprio', async () => {
    const viewer = await makeUser()
    const event = await makeEvent(viewer.id, { isPublic: true })

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    const found = res.json().data.find((e: { id: string }) => e.id === event.id)
    expect(found?.reason).toMatchObject({ kind: 'self_created' })
  })

  it('reason friend_created quando o autor é seguido', async () => {
    const viewer = await makeUser()
    const followed = await makeUser()
    await makeFollow(viewer.id, followed.id)
    const event = await makeEvent(followed.id, { isPublic: true })

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    const found = res.json().data.find((e: { id: string }) => e.id === event.id)
    expect(found?.reason).toMatchObject({
      kind: 'friend_created',
      user: { id: followed.id },
    })
  })

  it('reason friend_attending quando seguido confirmou presença', async () => {
    const viewer = await makeUser()
    const followed = await makeUser()
    const author = await makeUser()
    await makeFollow(viewer.id, followed.id)
    const event = await makeEvent(author.id, { isPublic: true })
    await makeAttendance(followed.id, event.id, 'CONFIRMED')

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    const found = res.json().data.find((e: { id: string }) => e.id === event.id)
    expect(found?.reason).toMatchObject({
      kind: 'friend_attending',
      user: { id: followed.id },
      type: 'CONFIRMED',
    })
  })

  it('reason friend_reacted quando seguido reagiu', async () => {
    const viewer = await makeUser()
    const followed = await makeUser()
    const author = await makeUser()
    await makeFollow(viewer.id, followed.id)
    const event = await makeEvent(author.id, { isPublic: true })
    await makeReaction(followed.id, event.id)

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    const found = res.json().data.find((e: { id: string }) => e.id === event.id)
    expect(found?.reason).toMatchObject({
      kind: 'friend_reacted',
      user: { id: followed.id },
    })
  })

  it('reason friend_commented quando seguido comentou', async () => {
    const viewer = await makeUser()
    const followed = await makeUser()
    const author = await makeUser()
    await makeFollow(viewer.id, followed.id)
    const event = await makeEvent(author.id, { isPublic: true })
    await makeComment(followed.id, event.id, 'Que evento incrível!')

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    const found = res.json().data.find((e: { id: string }) => e.id === event.id)
    expect(found?.reason).toMatchObject({
      kind: 'friend_commented',
      user: { id: followed.id },
      preview: 'Que evento incrível!',
    })
  })

  it('reason self_interaction quando viewer já interagiu', async () => {
    const viewer = await makeUser()
    const author = await makeUser()
    const followed = await makeUser()
    await makeFollow(viewer.id, followed.id)
    const event = await makeEvent(author.id, { isPublic: true })
    await makeAttendance(followed.id, event.id)
    await makeAttendance(viewer.id, event.id, 'INTERESTED')

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    const found = res.json().data.find((e: { id: string }) => e.id === event.id)
    expect(found?.reason).toMatchObject({ kind: 'self_interaction' })
  })
})
