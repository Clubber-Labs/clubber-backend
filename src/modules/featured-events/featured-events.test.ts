import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import { makeEvent, makeFeaturedEvent, makeUser } from '../../test/factories'
import { testPrisma } from '../../test/prisma'
import { reconcileFeaturedEvents } from './featured-events.reconciler'

let app: FastifyInstance

function token(app: FastifyInstance, userId: string) {
  return app.jwt.sign({ sub: userId })
}

function inFuture(ms: number) {
  return new Date(Date.now() + ms)
}

beforeAll(async () => {
  app = buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await testPrisma.$disconnect()
})

describe('POST /events/:id/featured', () => {
  it('201 quando premium dono cria janela ativa imediata', async () => {
    const author = await makeUser({ isPremium: true })
    const event = await makeEvent(author.id, { date: inFuture(86_400_000) })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/featured`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: {
        startsAt: new Date().toISOString(),
        endsAt: inFuture(3_600_000).toISOString(),
      },
    })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.eventId).toBe(event.id)
    expect(body.canceledAt).toBeNull()

    const updated = await testPrisma.event.findUnique({
      where: { id: event.id },
      select: { isFeatured: true },
    })
    expect(updated?.isFeatured).toBe(true)
  })

  it('401 sem token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/events/00000000-0000-0000-0000-000000000000/featured',
      body: {
        startsAt: new Date().toISOString(),
        endsAt: inFuture(3_600_000).toISOString(),
      },
    })
    expect(res.statusCode).toBe(401)
  })

  it('404 quando evento não existe', async () => {
    const user = await makeUser({ isPremium: true })
    const res = await app.inject({
      method: 'POST',
      url: '/events/00000000-0000-0000-0000-000000000000/featured',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: {
        startsAt: new Date().toISOString(),
        endsAt: inFuture(3_600_000).toISOString(),
      },
    })
    expect(res.statusCode).toBe(404)
  })

  it('403 quando autenticado não é o autor (mesmo premium)', async () => {
    const author = await makeUser({ isPremium: true })
    const other = await makeUser({ isPremium: true })
    const event = await makeEvent(author.id, { date: inFuture(86_400_000) })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/featured`,
      headers: { authorization: `Bearer ${token(app, other.id)}` },
      body: {
        startsAt: new Date().toISOString(),
        endsAt: inFuture(3_600_000).toISOString(),
      },
    })
    expect(res.statusCode).toBe(403)
  })

  it('403 quando autor não é premium', async () => {
    const author = await makeUser({ isPremium: false })
    const event = await makeEvent(author.id, { date: inFuture(86_400_000) })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/featured`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: {
        startsAt: new Date().toISOString(),
        endsAt: inFuture(3_600_000).toISOString(),
      },
    })
    expect(res.statusCode).toBe(403)
  })

  it('400 quando startsAt >= endsAt', async () => {
    const author = await makeUser({ isPremium: true })
    const event = await makeEvent(author.id, { date: inFuture(86_400_000) })
    const sameMoment = new Date()

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/featured`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: {
        startsAt: sameMoment.toISOString(),
        endsAt: sameMoment.toISOString(),
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('400 quando a duração excede o teto (PROMOTION_MAX_DURATION_DAYS)', async () => {
    const author = await makeUser({ isPremium: true })
    // Evento distante: assim quem barra a janela longa é o teto de duração, não
    // o limite "endsAt <= data do evento".
    const event = await makeEvent(author.id, {
      date: inFuture(30 * 86_400_000),
    })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/featured`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: {
        startsAt: new Date().toISOString(),
        endsAt: inFuture(8 * 86_400_000).toISOString(), // 8 dias > teto de 7
      },
    })

    expect(res.statusCode).toBe(400)
  })

  it('201 quando a duração é exatamente o teto (7 dias)', async () => {
    const author = await makeUser({ isPremium: true })
    const event = await makeEvent(author.id, {
      date: inFuture(30 * 86_400_000),
    })
    // start/end da MESMA base pra a diferença ser exatamente 7 dias (o check é
    // estrito `> teto`, então 7 dias cravados passa).
    const start = new Date()

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/featured`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: {
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + 7 * 86_400_000).toISOString(),
      },
    })

    expect(res.statusCode).toBe(201)
  })

  it('400 quando startsAt está no passado', async () => {
    const author = await makeUser({ isPremium: true })
    const event = await makeEvent(author.id, { date: inFuture(86_400_000) })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/featured`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: {
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        endsAt: inFuture(3_600_000).toISOString(),
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('400 quando endsAt > event.date', async () => {
    const author = await makeUser({ isPremium: true })
    const event = await makeEvent(author.id, { date: inFuture(3_600_000) })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/featured`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: {
        startsAt: new Date().toISOString(),
        endsAt: inFuture(7_200_000).toISOString(),
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('409 quando janela sobrepõe outra ativa', async () => {
    const author = await makeUser({ isPremium: true })
    const event = await makeEvent(author.id, { date: inFuture(86_400_000) })
    await makeFeaturedEvent(event.id, author.id, {
      startsAt: new Date(),
      endsAt: inFuture(3_600_000),
    })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/featured`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: {
        startsAt: inFuture(1_800_000).toISOString(),
        endsAt: inFuture(5_400_000).toISOString(),
      },
    })
    expect(res.statusCode).toBe(409)
  })
})

describe('DELETE /events/:id/featured/:featureId', () => {
  it('204 e isFeatured vira false quando era a única janela ativa', async () => {
    const author = await makeUser({ isPremium: true })
    const event = await makeEvent(author.id, {
      date: inFuture(86_400_000),
      isFeatured: true,
    })
    const feature = await makeFeaturedEvent(event.id, author.id)

    const res = await app.inject({
      method: 'DELETE',
      url: `/events/${event.id}/featured/${feature.id}`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })

    expect(res.statusCode).toBe(204)
    const updated = await testPrisma.event.findUnique({
      where: { id: event.id },
      select: { isFeatured: true },
    })
    expect(updated?.isFeatured).toBe(false)

    const canceled = await testPrisma.featuredEvent.findUnique({
      where: { id: feature.id },
    })
    expect(canceled?.canceledAt).toBeInstanceOf(Date)
  })

  it('204 mantém janelas futuras agendadas quando cancela a janela ativa', async () => {
    const author = await makeUser({ isPremium: true })
    const event = await makeEvent(author.id, {
      date: inFuture(86_400_000),
      isFeatured: true,
    })
    const active = await makeFeaturedEvent(event.id, author.id, {
      startsAt: new Date(Date.now() - 1_800_000),
      endsAt: inFuture(1_800_000),
    })
    const future = await makeFeaturedEvent(event.id, author.id, {
      startsAt: inFuture(7_200_000),
      endsAt: inFuture(10_800_000),
    })

    const res = await app.inject({
      method: 'DELETE',
      url: `/events/${event.id}/featured/${active.id}`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })

    expect(res.statusCode).toBe(204)

    const updated = await testPrisma.event.findUnique({
      where: { id: event.id },
      select: { isFeatured: true },
    })
    // Janela futura ainda não está ativa agora, então isFeatured cai pra false.
    expect(updated?.isFeatured).toBe(false)

    // A janela futura continua válida, pode entrar em vigor depois.
    const futureStill = await testPrisma.featuredEvent.findUnique({
      where: { id: future.id },
    })
    expect(futureStill?.canceledAt).toBeNull()
  })

  it('constraint do DB bloqueia overlap concorrente (safety-net da race)', async () => {
    const author = await makeUser({ isPremium: true })
    const event = await makeEvent(author.id, { date: inFuture(86_400_000) })
    await makeFeaturedEvent(event.id, author.id, {
      startsAt: new Date(),
      endsAt: inFuture(3_600_000),
    })

    await expect(
      testPrisma.featuredEvent.create({
        data: {
          eventId: event.id,
          createdBy: author.id,
          startsAt: inFuture(1_800_000),
          endsAt: inFuture(5_400_000),
        },
      }),
    ).rejects.toThrow(/featured_events_no_overlap_active/)
  })

  it('401 sem token', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/events/00000000-0000-0000-0000-000000000000/featured/00000000-0000-0000-0000-000000000000',
    })
    expect(res.statusCode).toBe(401)
  })

  it('403 quando não é o autor', async () => {
    const author = await makeUser({ isPremium: true })
    const other = await makeUser()
    const event = await makeEvent(author.id, { date: inFuture(86_400_000) })
    const feature = await makeFeaturedEvent(event.id, author.id)

    const res = await app.inject({
      method: 'DELETE',
      url: `/events/${event.id}/featured/${feature.id}`,
      headers: { authorization: `Bearer ${token(app, other.id)}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('404 quando featureId não pertence ao evento', async () => {
    const author = await makeUser({ isPremium: true })
    const event = await makeEvent(author.id, { date: inFuture(86_400_000) })
    const otherEvent = await makeEvent(author.id, {
      date: inFuture(86_400_000),
    })
    const feature = await makeFeaturedEvent(otherEvent.id, author.id)

    const res = await app.inject({
      method: 'DELETE',
      url: `/events/${event.id}/featured/${feature.id}`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })
    expect(res.statusCode).toBe(404)
  })

  it('409 quando já cancelado', async () => {
    const author = await makeUser({ isPremium: true })
    const event = await makeEvent(author.id, { date: inFuture(86_400_000) })
    const feature = await makeFeaturedEvent(event.id, author.id, {
      canceledAt: new Date(),
    })

    const res = await app.inject({
      method: 'DELETE',
      url: `/events/${event.id}/featured/${feature.id}`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })
    expect(res.statusCode).toBe(409)
  })
})

describe('GET /events — ordenação com destaques', () => {
  it('eventos destacados aparecem antes dos não-destacados', async () => {
    const author = await makeUser({ isPremium: true })
    const regular = await makeEvent(author.id, {
      isPublic: true,
      date: inFuture(3_600_000),
    })
    const featured = await makeEvent(author.id, {
      isPublic: true,
      isFeatured: true,
      date: inFuture(7_200_000),
    })

    const res = await app.inject({ method: 'GET', url: '/events' })

    expect(res.statusCode).toBe(200)
    const ids = res.json().data.map((e: { id: string }) => e.id)
    expect(ids.indexOf(featured.id)).toBeLessThan(ids.indexOf(regular.id))
  })

  it('mantém ordem por date dentro de cada grupo (destacados e não)', async () => {
    const author = await makeUser({ isPremium: true })
    const featLater = await makeEvent(author.id, {
      isPublic: true,
      isFeatured: true,
      date: inFuture(7_200_000),
    })
    const featEarlier = await makeEvent(author.id, {
      isPublic: true,
      isFeatured: true,
      date: inFuture(3_600_000),
    })
    const regLater = await makeEvent(author.id, {
      isPublic: true,
      date: inFuture(10_800_000),
    })
    const regEarlier = await makeEvent(author.id, {
      isPublic: true,
      date: inFuture(5_400_000),
    })

    const res = await app.inject({ method: 'GET', url: '/events' })
    const ids = res.json().data.map((e: { id: string }) => e.id)

    expect(ids).toEqual([
      featEarlier.id,
      featLater.id,
      regEarlier.id,
      regLater.id,
    ])
  })
})

describe('GET /feed — propaga isFeatured no payload', () => {
  it('inclui isFeatured: true/false conforme o evento', async () => {
    const author = await makeUser({ isPremium: true })
    const viewer = await makeUser()
    await testPrisma.follow.create({
      data: {
        followerId: viewer.id,
        followingId: author.id,
        status: 'ACCEPTED',
      },
    })
    await makeEvent(author.id, { isPublic: true, isFeatured: true })
    await makeEvent(author.id, { isPublic: true, isFeatured: false })

    const res = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.statusCode).toBe(200)
    const flags = res
      .json()
      .data.map((e: { isFeatured: boolean }) => e.isFeatured)
    expect(flags).toContain(true)
    expect(flags).toContain(false)
  })
})

describe('reconcileFeaturedEvents', () => {
  it('desliga isFeatured quando todas as janelas expiraram', async () => {
    const author = await makeUser({ isPremium: true })
    const event = await makeEvent(author.id, {
      date: inFuture(86_400_000),
      isFeatured: true,
    })
    const past = new Date(Date.now() - 3_600_000)
    await makeFeaturedEvent(event.id, author.id, {
      startsAt: new Date(Date.now() - 7_200_000),
      endsAt: past,
    })

    await reconcileFeaturedEvents()

    const updated = await testPrisma.event.findUnique({
      where: { id: event.id },
      select: { isFeatured: true },
    })
    expect(updated?.isFeatured).toBe(false)
  })

  it('liga isFeatured quando uma janela está ativa mas a flag está falsa', async () => {
    const author = await makeUser({ isPremium: true })
    const event = await makeEvent(author.id, {
      date: inFuture(86_400_000),
      isFeatured: false,
    })
    await makeFeaturedEvent(event.id, author.id, {
      startsAt: new Date(Date.now() - 1_800_000),
      endsAt: inFuture(1_800_000),
    })

    await reconcileFeaturedEvents()

    const updated = await testPrisma.event.findUnique({
      where: { id: event.id },
      select: { isFeatured: true },
    })
    expect(updated?.isFeatured).toBe(true)
  })

  it('não altera quando há janela ativa e flag já é true', async () => {
    const author = await makeUser({ isPremium: true })
    const event = await makeEvent(author.id, {
      date: inFuture(86_400_000),
      isFeatured: true,
    })
    await makeFeaturedEvent(event.id, author.id, {
      startsAt: new Date(Date.now() - 1_800_000),
      endsAt: inFuture(1_800_000),
    })

    await reconcileFeaturedEvents()

    const updated = await testPrisma.event.findUnique({
      where: { id: event.id },
      select: { isFeatured: true },
    })
    expect(updated?.isFeatured).toBe(true)
  })
})

// Quota mensal de promoções (RF11.4+): consumida atomicamente na criação.
describe('quota mensal de promoções', () => {
  function currentPeriod() {
    const now = new Date()
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  }

  function previousPeriod() {
    const now = new Date()
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  }

  async function promote(authorId: string) {
    const event = await makeEvent(authorId, { date: inFuture(86_400_000) })
    return app.inject({
      method: 'POST',
      url: `/events/${event.id}/featured`,
      headers: { authorization: `Bearer ${token(app, authorId)}` },
      body: {
        startsAt: new Date().toISOString(),
        endsAt: inFuture(3_600_000).toISOString(),
      },
    })
  }

  it('promover consome 1 da quota do mês corrente', async () => {
    const author = await makeUser({ isPremium: true })

    const res = await promote(author.id)

    expect(res.statusCode).toBe(201)
    const usage = await testPrisma.eventPromotionUsage.findUnique({
      where: {
        userId_period: { userId: author.id, period: currentPeriod() },
      },
    })
    expect(usage?.count).toBe(1)
  })

  it('429 quando a quota do mês está esgotada', async () => {
    const author = await makeUser({ isPremium: true })
    // Esgota a quota direto no banco (limite default = 3).
    await testPrisma.eventPromotionUsage.create({
      data: { userId: author.id, period: currentPeriod(), count: 3 },
    })

    const res = await promote(author.id)

    expect(res.statusCode).toBe(429)
    // Tentativa rejeitada não consome (rollback).
    const usage = await testPrisma.eventPromotionUsage.findUnique({
      where: {
        userId_period: { userId: author.id, period: currentPeriod() },
      },
    })
    expect(usage?.count).toBe(3)
  })

  it('quota esgotada no mês PASSADO não afeta o mês corrente', async () => {
    const author = await makeUser({ isPremium: true })
    await testPrisma.eventPromotionUsage.create({
      data: { userId: author.id, period: previousPeriod(), count: 3 },
    })

    const res = await promote(author.id)

    expect(res.statusCode).toBe(201)
  })

  it('cancelar o destaque NÃO devolve a quota', async () => {
    const author = await makeUser({ isPremium: true })
    const event = await makeEvent(author.id, { date: inFuture(86_400_000) })
    const created = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/featured`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: {
        startsAt: new Date().toISOString(),
        endsAt: inFuture(3_600_000).toISOString(),
      },
    })
    expect(created.statusCode).toBe(201)

    const del = await app.inject({
      method: 'DELETE',
      url: `/events/${event.id}/featured/${created.json().id}`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })
    expect(del.statusCode).toBe(204)

    const usage = await testPrisma.eventPromotionUsage.findUnique({
      where: {
        userId_period: { userId: author.id, period: currentPeriod() },
      },
    })
    expect(usage?.count).toBe(1)
  })
})
