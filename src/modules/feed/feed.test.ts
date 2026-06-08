import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../../test/app'
import {
  makeAttendance,
  makeComment,
  makeEvent,
  makeFollow,
  makeInvite,
  makeReaction,
  makeUser,
  makeUserCategoryPreference,
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

  it('mostra evento público de autor privado quando amigo interage', async () => {
    const viewer = await makeUser()
    const friend = await makeUser()
    const privateAuthor = await makeUser({ isPrivate: true })
    await makeFollow(viewer.id, friend.id, 'ACCEPTED')
    const event = await makeEvent(privateAuthor.id, { isPublic: true })
    await makeAttendance(friend.id, event.id, 'CONFIRMED')

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    const found = res.json().data.find((e: { id: string }) => e.id === event.id)
    expect(found).toBeDefined()
  })

  it('mostra evento de autor privado quando viewer também segue o autor', async () => {
    const viewer = await makeUser()
    const privateAuthor = await makeUser({ isPrivate: true })
    await makeFollow(viewer.id, privateAuthor.id, 'ACCEPTED')
    const event = await makeEvent(privateAuthor.id, { isPublic: true })

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    const found = res.json().data.find((e: { id: string }) => e.id === event.id)
    expect(found).toBeDefined()
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

  it('?category=PARTY filtra por categoria', async () => {
    const viewer = await makeUser()
    const festa = await makeEvent(viewer.id, {
      isPublic: true,
      category: 'PARTY',
    })
    const show = await makeEvent(viewer.id, {
      isPublic: true,
      category: 'MUSIC',
    })

    const res = await app.inject({
      method: 'GET',
      url: '/feed?category=PARTY',
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
    // Histórico: viewer já participou de eventos de "PARTY"
    const histAuthor = await makeUser()
    for (let i = 0; i < 3; i++) {
      const histEvent = await makeEvent(histAuthor.id, {
        isPublic: true,
        category: 'PARTY',
      })
      await makeAttendance(viewer.id, histEvent.id, 'CONFIRMED')
    }

    const sameDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
    const author = await makeUser()
    const festa = await makeEvent(author.id, {
      isPublic: true,
      category: 'PARTY',
      date: sameDate,
    })
    const show = await makeEvent(author.id, {
      isPublic: true,
      category: 'MUSIC',
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

  it('não repete eventos quando o relógio avança entre as páginas', async () => {
    // O score é função de `now` (decay temporal). Se cada página recalcula com
    // um `now` novo, a fronteira do cursor escorrega e eventos da página 1
    // reaparecem na 2. Aqui congelamos o relógio só para forçar esse avanço.
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const t1 = new Date('2026-06-01T12:00:00.000Z')
      vi.setSystemTime(t1)

      const viewer = await makeUser()

      // 5 eventos PAST do próprio viewer, mesma data e categoria: o score só
      // varia pelo engajamento (estável). O sinal temporal é idêntico entre
      // eles e DECAI com o tempo — é o que move a fronteira do cursor.
      const start = new Date(t1.getTime() - 6 * 60 * 60 * 1000)
      const end = new Date(t1.getTime() - 2 * 60 * 60 * 1000)
      for (let i = 0; i < 5; i++) {
        const event = await makeEvent(viewer.id, {
          isPublic: true,
          category: 'PARTY',
          date: start,
          endDate: end,
        })
        await makeStrangerAttendees(event.id, i + 1)
      }

      const page1 = await app.inject({
        method: 'GET',
        url: '/feed?limit=2',
        headers: { authorization: `Bearer ${token(app, viewer.id)}` },
      })
      const body1 = page1.json()
      expect(body1.data.length).toBe(2)
      expect(body1.nextCursor).toBeTruthy()

      // 24h depois: os eventos PAST decaíram no ranking. Sem congelar o relógio
      // no cursor, o filtro `score < cursor.score` deixa a página 1 vazar pra cá.
      vi.setSystemTime(new Date(t1.getTime() + 24 * 60 * 60 * 1000))

      const page2 = await app.inject({
        method: 'GET',
        url: `/feed?limit=2&cursor=${body1.nextCursor}`,
        headers: { authorization: `Bearer ${token(app, viewer.id)}` },
      })
      const body2 = page2.json()

      const ids1: string[] = body1.data.map((e: { id: string }) => e.id)
      const ids2: string[] = body2.data.map((e: { id: string }) => e.id)
      const all = [...ids1, ...ids2]
      expect(new Set(all).size).toBe(all.length)
      expect(ids1.some((id) => ids2.includes(id))).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('cursor com t forjado não burla o filtro de status (lifecycle usa o now real)', async () => {
    const viewer = await makeUser()
    // Evento PAST do viewer (não deveria aparecer sob status=UPCOMING).
    const past = await makeEvent(viewer.id, {
      isPublic: true,
      date: new Date(Date.now() - 6 * 60 * 60 * 1000),
      endDate: new Date(Date.now() - 2 * 60 * 60 * 1000),
    })
    const upcoming = await makeEvent(viewer.id, {
      isPublic: true,
      date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    })

    // Cursor forjado: t bem no passado faria o WHERE de lifecycle (se usasse o
    // t do cursor) tratar o evento PAST como UPCOMING. score alto garante que o
    // keyset não filtre ninguém.
    const forged = Buffer.from(
      JSON.stringify({
        score: Number.MAX_SAFE_INTEGER,
        id: '00000000-0000-0000-0000-000000000000',
        t: new Date('2020-01-01T00:00:00.000Z').getTime(),
      }),
    ).toString('base64url')

    const res = await app.inject({
      method: 'GET',
      url: `/feed?status=UPCOMING&cursor=${forged}`,
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.statusCode).toBe(200)
    const ids = res.json().data.map((e: { id: string }) => e.id)
    expect(ids).not.toContain(past.id)
    expect(ids).toContain(upcoming.id)
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

const NEAR = { lat: -25.4, lng: -49.3 } // Curitiba (coords default do makeEvent)
const FAR = { lat: -30, lng: -49.3 } // ~510km ao sul

async function makeStrangerAttendees(eventId: string, count: number) {
  for (let i = 0; i < count; i++) {
    const u = await makeUser()
    await makeAttendance(u.id, eventId, 'CONFIRMED')
  }
}

describe('GET /feed — descoberta', () => {
  it('sem follows, eventos da categoria preferida aparecem (req 1)', async () => {
    const viewer = await makeUser()
    await makeUserCategoryPreference(viewer.id, 'MUSIC')
    const stranger = await makeUser()
    const musicEvent = await makeEvent(stranger.id, {
      isPublic: true,
      category: 'MUSIC',
    })

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.statusCode).toBe(200)
    const ids = res.json().data.map((e: { id: string }) => e.id)
    expect(ids).toContain(musicEvent.id)
  })

  it('evento público de autor privado aparece na descoberta por categoria', async () => {
    const viewer = await makeUser()
    await makeUserCategoryPreference(viewer.id, 'MUSIC')
    const privateAuthor = await makeUser({ isPrivate: true })
    const event = await makeEvent(privateAuthor.id, {
      isPublic: true,
      category: 'MUSIC',
    })

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.statusCode).toBe(200)
    const ids = res.json().data.map((e: { id: string }) => e.id)
    expect(ids).toContain(event.id)
  })

  it('evento de descoberta vem com reason discovery', async () => {
    const viewer = await makeUser()
    await makeUserCategoryPreference(viewer.id, 'TECH')
    const stranger = await makeUser()
    const techEvent = await makeEvent(stranger.id, {
      isPublic: true,
      category: 'TECH',
    })

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    const found = res
      .json()
      .data.find((e: { id: string }) => e.id === techEvent.id)
    expect(found?.reason).toMatchObject({ kind: 'discovery' })
  })

  it('sem follows, sem preferências e sem localização → não puxa estranhos', async () => {
    const viewer = await makeUser()
    const stranger = await makeUser()
    const event = await makeEvent(stranger.id, { isPublic: true })

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    const ids = res.json().data.map((e: { id: string }) => e.id)
    expect(ids).not.toContain(event.id)
  })

  it('cache isola por localização (nearLat diferente muda resultado)', async () => {
    const viewer = await makeUser()
    const stranger = await makeUser()
    const event = await makeEvent(stranger.id, {
      isPublic: true,
      latitude: NEAR.lat,
      longitude: NEAR.lng,
    })

    const near = await app.inject({
      method: 'GET',
      url: `/feed?nearLat=${NEAR.lat}&nearLng=${NEAR.lng}&radiusKm=20`,
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })
    const far = await app.inject({
      method: 'GET',
      url: '/feed?nearLat=-5&nearLng=-40&radiusKm=20',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(near.json().data.map((e: { id: string }) => e.id)).toContain(
      event.id,
    )
    expect(far.json().data.map((e: { id: string }) => e.id)).not.toContain(
      event.id,
    )
  })

  it('cache isola por filtro (category não vaza pra query sem filtro)', async () => {
    const viewer = await makeUser()
    const music = await makeEvent(viewer.id, {
      isPublic: true,
      category: 'MUSIC',
    })
    const sports = await makeEvent(viewer.id, {
      isPublic: true,
      category: 'SPORTS',
    })

    // 1ª request com ?category=MUSIC popula o cache dessa combinação
    const filtered = await app.inject({
      method: 'GET',
      url: '/feed?category=MUSIC',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })
    const filteredIds = filtered.json().data.map((e: { id: string }) => e.id)
    expect(filteredIds).toContain(music.id)
    expect(filteredIds).not.toContain(sports.id)

    // 2ª request SEM filtro não pode receber o cache da 1ª (key diferente)
    const all = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })
    const allIds = all.json().data.map((e: { id: string }) => e.id)
    expect(allIds).toContain(sports.id)
    expect(allIds).toContain(music.id)
  })

  it('sem localização: feed funciona e não quebra (proximidade neutra)', async () => {
    const viewer = await makeUser()
    await makeEvent(viewer.id, { isPublic: true, latitude: NEAR.lat })
    await makeEvent(viewer.id, { isPublic: true, latitude: FAR.lat })

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.length).toBeGreaterThanOrEqual(2)
  })
})

describe('GET /feed — proximidade e popularidade', () => {
  it('pool social: amigo distante aparece mesmo com radiusKm (req 3)', async () => {
    const viewer = await makeUser()
    const friend = await makeUser()
    await makeFollow(viewer.id, friend.id)

    const author = await makeUser()
    const farFriendEvent = await makeEvent(author.id, {
      isPublic: true,
      latitude: FAR.lat,
      longitude: FAR.lng,
    })
    await makeAttendance(friend.id, farFriendEvent.id, 'CONFIRMED')

    const stranger = await makeUser()
    const farStrangerEvent = await makeEvent(stranger.id, {
      isPublic: true,
      latitude: FAR.lat,
      longitude: FAR.lng,
    })

    const res = await app.inject({
      method: 'GET',
      url: `/feed?nearLat=${NEAR.lat}&nearLng=${NEAR.lng}&radiusKm=50`,
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    const ids = res.json().data.map((e: { id: string }) => e.id)
    expect(ids).toContain(farFriendEvent.id) // social ignora distância
    expect(ids).not.toContain(farStrangerEvent.id) // descoberta limitada pelo raio
  })

  it('popularidade lidera: popular distante vence perto e vazio (req 2)', async () => {
    const viewer = await makeUser()
    const date = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)

    const authorA = await makeUser()
    const popularFar = await makeEvent(authorA.id, {
      isPublic: true,
      latitude: FAR.lat,
      longitude: FAR.lng,
      date,
    })
    await makeStrangerAttendees(popularFar.id, 12)

    const authorB = await makeUser()
    const emptyNear = await makeEvent(authorB.id, {
      isPublic: true,
      latitude: NEAR.lat,
      longitude: NEAR.lng,
      date,
    })

    const res = await app.inject({
      method: 'GET',
      url: `/feed?nearLat=${NEAR.lat}&nearLng=${NEAR.lng}`,
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    const ids = res
      .json()
      .data.map((e: { id: string }) => e.id)
      .filter((id: string) => id === popularFar.id || id === emptyNear.id)
    expect(ids).toEqual([popularFar.id, emptyNear.id])
  })

  it('popularidade lidera: popular futuro vence ONGOING vazio', async () => {
    const viewer = await makeUser()
    const ongoing = await makeEvent(viewer.id, {
      isPublic: true,
      date: new Date(Date.now() - 30 * 60 * 1000),
      endDate: new Date(Date.now() + 30 * 60 * 1000),
    })
    const authorP = await makeUser()
    const popularFuture = await makeEvent(authorP.id, {
      isPublic: true,
      date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    })
    await makeStrangerAttendees(popularFuture.id, 15)

    const res = await app.inject({
      method: 'GET',
      url: `/feed?nearLat=${NEAR.lat}&nearLng=${NEAR.lng}`,
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    const ids = res
      .json()
      .data.map((e: { id: string }) => e.id)
      .filter((id: string) => id === popularFuture.id || id === ongoing.id)
    expect(ids).toEqual([popularFuture.id, ongoing.id])
  })

  it('preferência explícita supera o histórico no ranking', async () => {
    const viewer = await makeUser()
    // Histórico em SPORTS
    const histAuthor = await makeUser()
    for (let i = 0; i < 3; i++) {
      const e = await makeEvent(histAuthor.id, {
        isPublic: true,
        category: 'SPORTS',
      })
      await makeAttendance(viewer.id, e.id, 'CONFIRMED')
    }
    // Preferência explícita em TECH
    await makeUserCategoryPreference(viewer.id, 'TECH')

    const date = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
    const author = await makeUser()
    const techEvent = await makeEvent(author.id, {
      isPublic: true,
      category: 'TECH',
      date,
    })
    const sportsEvent = await makeEvent(author.id, {
      isPublic: true,
      category: 'SPORTS',
      date,
    })
    const friend = await makeUser()
    await makeFollow(viewer.id, friend.id)
    await makeAttendance(friend.id, techEvent.id, 'INTERESTED')
    await makeAttendance(friend.id, sportsEvent.id, 'INTERESTED')

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    const ids = res
      .json()
      .data.map((e: { id: string }) => e.id)
      .filter((id: string) => id === techEvent.id || id === sportsEvent.id)
    expect(ids).toEqual([techEvent.id, sportsEvent.id])
  })
})

describe('GET /feed — engajamento de amigos', () => {
  it('evento sobe a cada amigo distinto que interage', async () => {
    const viewer = await makeUser()
    const f1 = await makeUser()
    const f2 = await makeUser()
    await makeFollow(viewer.id, f1.id)
    await makeFollow(viewer.id, f2.id)

    const author = await makeUser()
    const date = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
    const eventTwoFriends = await makeEvent(author.id, { isPublic: true, date })
    const eventOneFriend = await makeEvent(author.id, { isPublic: true, date })

    await makeAttendance(f1.id, eventTwoFriends.id, 'CONFIRMED')
    await makeAttendance(f2.id, eventTwoFriends.id, 'CONFIRMED')
    await makeAttendance(f1.id, eventOneFriend.id, 'CONFIRMED')

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    const ids = res
      .json()
      .data.map((e: { id: string }) => e.id)
      .filter(
        (id: string) => id === eventTwoFriends.id || id === eventOneFriend.id,
      )
    expect(ids).toEqual([eventTwoFriends.id, eventOneFriend.id])
  })

  it('interação de amigo pesa mais que de estranho (mesmo nº)', async () => {
    const viewer = await makeUser()
    const friend = await makeUser()
    await makeFollow(viewer.id, friend.id)
    await makeUserCategoryPreference(viewer.id, 'MUSIC')

    const date = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
    const author = await makeUser()
    const friendEvent = await makeEvent(author.id, {
      isPublic: true,
      category: 'MUSIC',
      date,
    })
    await makeAttendance(friend.id, friendEvent.id, 'CONFIRMED')

    const author2 = await makeUser()
    const strangerEvent = await makeEvent(author2.id, {
      isPublic: true,
      category: 'MUSIC',
      date,
    })
    const stranger = await makeUser()
    await makeAttendance(stranger.id, strangerEvent.id, 'CONFIRMED')

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    const ids = res
      .json()
      .data.map((e: { id: string }) => e.id)
      .filter((id: string) => id === friendEvent.id || id === strangerEvent.id)
    expect(ids).toEqual([friendEvent.id, strangerEvent.id])
  })
})

describe('visibilidade no feed por status do autor', () => {
  it('não inclui evento de autor desativado', async () => {
    const viewer = await makeUser()
    const author = await makeUser()
    await makeFollow(viewer.id, author.id)
    const event = await makeEvent(author.id)

    await testPrisma.user.update({
      where: { id: author.id },
      data: { accountStatus: 'DEACTIVATED' },
    })

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.statusCode).toBe(200)
    const ids = res.json().data.map((e: { id: string }) => e.id)
    expect(ids).not.toContain(event.id)
  })
})
