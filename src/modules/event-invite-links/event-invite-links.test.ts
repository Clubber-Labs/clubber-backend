import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_DURATION_MS } from '../../lib/event-lifecycle'
import { buildApp } from '../../test/app'
import {
  makeBlock,
  makeEvent,
  makeInvite,
  makeInviteLink,
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

describe('POST /events/:eventId/invite-links', () => {
  it('autor cria link com expiração no endDate do evento', async () => {
    const author = await makeUser()
    const endDate = new Date(Date.now() + 3 * 86400000)
    const event = await makeEvent(author.id, {
      isPublic: false,
      date: new Date(Date.now() + 2 * 86400000),
      endDate,
    })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/invite-links`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.token).toBeTruthy()
    expect(body.url).toContain(`/e/${body.token}`)
    expect(new Date(body.expiresAt).getTime()).toBe(endDate.getTime())
    expect(body.usesCount).toBe(0)
  })

  it('sem endDate expira em date + duração padrão', async () => {
    const author = await makeUser()
    const date = new Date(Date.now() + 86400000)
    const event = await makeEvent(author.id, {
      isPublic: false,
      date,
      endDate: null,
    })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/invite-links`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })

    expect(res.statusCode).toBe(201)
    expect(new Date(res.json().expiresAt).getTime()).toBe(
      date.getTime() + DEFAULT_DURATION_MS,
    )
  })

  it('POSTs concorrentes não criam dois links ativos', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })
    const headers = { authorization: `Bearer ${token(app, author.id)}` }

    // Sem o advisory lock por evento, ambos veriam "nenhum link ativo" e cada
    // um criaria o seu — o lock serializa: um cria (201), o outro reusa (200).
    const [a, b] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/events/${event.id}/invite-links`,
        headers,
      }),
      app.inject({
        method: 'POST',
        url: `/events/${event.id}/invite-links`,
        headers,
      }),
    ])

    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201])
    expect(a.json().token).toBe(b.json().token)

    const count = await testPrisma.eventInviteLink.count({
      where: { eventId: event.id },
    })
    expect(count).toBe(1)
  })

  it('reusa o link vigente em vez de acumular (idempotente)', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })

    const first = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/invite-links`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })
    const second = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/invite-links`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })

    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(200)
    expect(second.json().token).toBe(first.json().token)

    const count = await testPrisma.eventInviteLink.count({
      where: { eventId: event.id },
    })
    expect(count).toBe(1)
  })

  it('depois de revogar, cria um link novo', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })
    const revoked = await makeInviteLink(event.id, author.id, {
      revokedAt: new Date(),
    })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/invite-links`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().token).not.toBe(revoked.token)
  })

  it('evento público também gera link', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id, { isPublic: true })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/invite-links`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })

    expect(res.statusCode).toBe(201)
  })

  it('retorna 403 para não-autor', async () => {
    const author = await makeUser()
    const other = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/invite-links`,
      headers: { authorization: `Bearer ${token(app, other.id)}` },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('NOT_EVENT_AUTHOR')
  })

  it('retorna 404 para evento inexistente', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'POST',
      url: '/events/00000000-0000-0000-0000-000000000000/invite-links',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(404)
  })

  it('retorna 400 para evento cancelado', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id, {
      isPublic: false,
      canceledAt: new Date(),
    })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/invite-links`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('EVENT_CANCELED')
  })

  it('retorna 400 para evento já encerrado', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id, {
      isPublic: false,
      date: new Date(Date.now() - 2 * 86400000),
      endDate: new Date(Date.now() - 86400000),
    })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/invite-links`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('EVENT_ENDED')
  })

  it('retorna 401 sem autenticação', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/invite-links`,
    })

    expect(res.statusCode).toBe(401)
  })
})

describe('GET /events/:eventId/invite-links', () => {
  it('autor lista os links com usesCount', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })
    await makeInviteLink(event.id, author.id, { usesCount: 3 })

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}/invite-links`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveLength(1)
    expect(body[0]).toMatchObject({ usesCount: 3 })
    expect(body[0].url).toContain(`/e/${body[0].token}`)
  })

  it('retorna 403 para não-autor', async () => {
    const author = await makeUser()
    const other = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}/invite-links`,
      headers: { authorization: `Bearer ${token(app, other.id)}` },
    })

    expect(res.statusCode).toBe(403)
  })
})

describe('DELETE /events/:eventId/invite-links/:linkId', () => {
  it('autor revoga e o token deixa de valer', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })
    const link = await makeInviteLink(event.id, author.id)

    const res = await app.inject({
      method: 'DELETE',
      url: `/events/${event.id}/invite-links/${link.id}`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })

    expect(res.statusCode).toBe(204)

    const preview = await app.inject({
      method: 'GET',
      url: `/invites/${link.token}`,
    })
    expect(preview.statusCode).toBe(410)
    expect(preview.json().code).toBe('INVITE_LINK_REVOKED')
  })

  it('retorna 404 para link de outro evento', async () => {
    const author = await makeUser()
    const eventA = await makeEvent(author.id, { isPublic: false })
    const eventB = await makeEvent(author.id, { isPublic: false })
    const link = await makeInviteLink(eventA.id, author.id)

    const res = await app.inject({
      method: 'DELETE',
      url: `/events/${eventB.id}/invite-links/${link.id}`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('INVITE_LINK_NOT_FOUND')
  })

  it('retorna 403 para não-autor', async () => {
    const author = await makeUser()
    const other = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })
    const link = await makeInviteLink(event.id, author.id)

    const res = await app.inject({
      method: 'DELETE',
      url: `/events/${event.id}/invite-links/${link.id}`,
      headers: { authorization: `Bearer ${token(app, other.id)}` },
    })

    expect(res.statusCode).toBe(403)
  })
})

describe('GET /invites/:token', () => {
  it('anônimo vê preview de evento privado sem endereço', async () => {
    const author = await makeUser({ isPrivate: true })
    const event = await makeEvent(author.id, {
      isPublic: false,
      address: 'Rua Secreta, 123',
    })
    const link = await makeInviteLink(event.id, author.id)

    const res = await app.inject({
      method: 'GET',
      url: `/invites/${link.token}`,
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.event).toMatchObject({
      id: event.id,
      title: event.title,
      isPublic: false,
    })
    expect(body.event.author.username).toBe(author.username)
    expect(body.event.address).toBeUndefined()
    expect(body.event.latitude).toBeUndefined()
    expect(body.viewer.hasAccess).toBe(false)
  })

  it('convidado logado tem hasAccess true', async () => {
    const author = await makeUser()
    const invitee = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })
    await makeInvite(event.id, author.id, invitee.id)
    const link = await makeInviteLink(event.id, author.id)

    const res = await app.inject({
      method: 'GET',
      url: `/invites/${link.token}`,
      headers: { authorization: `Bearer ${token(app, invitee.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().viewer.hasAccess).toBe(true)
  })

  it('autor tem hasAccess true', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })
    const link = await makeInviteLink(event.id, author.id)

    const res = await app.inject({
      method: 'GET',
      url: `/invites/${link.token}`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })

    expect(res.json().viewer.hasAccess).toBe(true)
  })

  it('evento público dá hasAccess até para anônimo', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id, { isPublic: true })
    const link = await makeInviteLink(event.id, author.id)

    const res = await app.inject({
      method: 'GET',
      url: `/invites/${link.token}`,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().viewer.hasAccess).toBe(true)
  })

  it('retorna 404 para token inexistente', async () => {
    const res = await app.inject({ method: 'GET', url: '/invites/nao-existe' })

    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('INVITE_LINK_NOT_FOUND')
  })

  it('retorna 410 para link expirado', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })
    const link = await makeInviteLink(event.id, author.id, {
      expiresAt: new Date(Date.now() - 1000),
    })

    const res = await app.inject({
      method: 'GET',
      url: `/invites/${link.token}`,
    })

    expect(res.statusCode).toBe(410)
    expect(res.json().code).toBe('INVITE_LINK_EXPIRED')
  })

  it('retorna 410 para evento cancelado', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id, {
      isPublic: false,
      canceledAt: new Date(),
    })
    const link = await makeInviteLink(event.id, author.id)

    const res = await app.inject({
      method: 'GET',
      url: `/invites/${link.token}`,
    })

    expect(res.statusCode).toBe(410)
    expect(res.json().code).toBe('EVENT_CANCELED')
  })

  it('retorna 404 para viewer bloqueado pelo autor', async () => {
    const author = await makeUser()
    const blocked = await makeUser()
    await makeBlock(author.id, blocked.id)
    const event = await makeEvent(author.id, { isPublic: false })
    const link = await makeInviteLink(event.id, author.id)

    const res = await app.inject({
      method: 'GET',
      url: `/invites/${link.token}`,
      headers: { authorization: `Bearer ${token(app, blocked.id)}` },
    })

    expect(res.statusCode).toBe(404)
  })

  it('retorna 404 quando o autor está banido', async () => {
    const author = await makeUser({ accountStatus: 'BANNED' })
    const event = await makeEvent(author.id, { isPublic: false })
    const link = await makeInviteLink(event.id, author.id)

    const res = await app.inject({
      method: 'GET',
      url: `/invites/${link.token}`,
    })

    expect(res.statusCode).toBe(404)
  })
})

describe('POST /invites/:token/accept', () => {
  it('materializa o convite e abre o evento até sem follow no autor privado', async () => {
    const author = await makeUser({ isPrivate: true })
    const guest = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })
    const link = await makeInviteLink(event.id, author.id)

    const res = await app.inject({
      method: 'POST',
      url: `/invites/${link.token}/accept`,
      headers: { authorization: `Bearer ${token(app, guest.id)}` },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ eventId: event.id })

    const invite = await testPrisma.eventInvite.findUnique({
      where: {
        eventId_invitedId: { eventId: event.id, invitedId: guest.id },
      },
    })
    expect(invite).not.toBeNull()
    expect(invite?.inviterId).toBe(author.id)

    const updated = await testPrisma.eventInviteLink.findUnique({
      where: { id: link.id },
    })
    expect(updated?.usesCount).toBe(1)

    // A concessão vale na porta única de acesso: o convidado NÃO segue o autor
    // privado e mesmo assim abre o evento.
    const eventRes = await app.inject({
      method: 'GET',
      url: `/events/${event.id}`,
      headers: { authorization: `Bearer ${token(app, guest.id)}` },
    })
    expect(eventRes.statusCode).toBe(200)
  })

  it('re-aceitar é idempotente e não infla usesCount', async () => {
    const author = await makeUser()
    const guest = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })
    const link = await makeInviteLink(event.id, author.id)

    const first = await app.inject({
      method: 'POST',
      url: `/invites/${link.token}/accept`,
      headers: { authorization: `Bearer ${token(app, guest.id)}` },
    })
    const second = await app.inject({
      method: 'POST',
      url: `/invites/${link.token}/accept`,
      headers: { authorization: `Bearer ${token(app, guest.id)}` },
    })

    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(200)

    const updated = await testPrisma.eventInviteLink.findUnique({
      where: { id: link.id },
    })
    expect(updated?.usesCount).toBe(1)
  })

  it('evento público aceita sem materializar convite', async () => {
    const author = await makeUser()
    const guest = await makeUser()
    const event = await makeEvent(author.id, { isPublic: true })
    const link = await makeInviteLink(event.id, author.id)

    const res = await app.inject({
      method: 'POST',
      url: `/invites/${link.token}/accept`,
      headers: { authorization: `Bearer ${token(app, guest.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ eventId: event.id })

    const invites = await testPrisma.eventInvite.count({
      where: { eventId: event.id },
    })
    expect(invites).toBe(0)
  })

  it('autor aceita o próprio link sem criar convite', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })
    const link = await makeInviteLink(event.id, author.id)

    const res = await app.inject({
      method: 'POST',
      url: `/invites/${link.token}/accept`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })

    expect(res.statusCode).toBe(200)

    const invites = await testPrisma.eventInvite.count({
      where: { eventId: event.id },
    })
    expect(invites).toBe(0)
  })

  it('retorna 401 sem autenticação', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })
    const link = await makeInviteLink(event.id, author.id)

    const res = await app.inject({
      method: 'POST',
      url: `/invites/${link.token}/accept`,
    })

    expect(res.statusCode).toBe(401)
  })

  it('retorna 410 para link expirado sem materializar convite', async () => {
    const author = await makeUser()
    const guest = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })
    const link = await makeInviteLink(event.id, author.id, {
      expiresAt: new Date(Date.now() - 1000),
    })

    const res = await app.inject({
      method: 'POST',
      url: `/invites/${link.token}/accept`,
      headers: { authorization: `Bearer ${token(app, guest.id)}` },
    })

    expect(res.statusCode).toBe(410)

    const invites = await testPrisma.eventInvite.count({
      where: { eventId: event.id },
    })
    expect(invites).toBe(0)
  })

  it('retorna 404 para viewer bloqueado, sem materializar convite', async () => {
    const author = await makeUser()
    const blocked = await makeUser()
    await makeBlock(author.id, blocked.id)
    const event = await makeEvent(author.id, { isPublic: false })
    const link = await makeInviteLink(event.id, author.id)

    const res = await app.inject({
      method: 'POST',
      url: `/invites/${link.token}/accept`,
      headers: { authorization: `Bearer ${token(app, blocked.id)}` },
    })

    expect(res.statusCode).toBe(404)

    const invites = await testPrisma.eventInvite.count({
      where: { eventId: event.id },
    })
    expect(invites).toBe(0)
  })
})
