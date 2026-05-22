import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import {
  makeAdmin,
  makeComment,
  makeEvent,
  makeReport,
  makeUser,
} from '../../test/factories'
import { testPrisma } from '../../test/prisma'

let app: FastifyInstance

function token(userId: string, role: 'USER' | 'ADMIN') {
  return app.jwt.sign({ sub: userId, role })
}

beforeAll(async () => {
  app = buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await testPrisma.$disconnect()
})

// ---------------------------------------------------------------------------
// PATCH /admin/users/:id/ban
// ---------------------------------------------------------------------------

describe('PATCH /admin/users/:id/ban', () => {
  it('admin bane usuário comum com sucesso', async () => {
    const admin = await makeAdmin()
    const target = await makeUser()

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${target.id}/ban`,
      headers: { authorization: `Bearer ${token(admin.id, 'ADMIN')}` },
      body: { reason: 'Violação dos termos de uso' },
    })

    expect(res.statusCode).toBe(204)

    const updated = await testPrisma.user.findUnique({
      where: { id: target.id },
    })
    expect(updated?.isBanned).toBe(true)
    expect(updated?.bannedAt).not.toBeNull()
  })

  it('admin bane usuário informando motivo', async () => {
    const admin = await makeAdmin()
    const target = await makeUser()

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${target.id}/ban`,
      headers: { authorization: `Bearer ${token(admin.id, 'ADMIN')}` },
      body: { reason: 'Conteúdo inapropriado reiterado' },
    })

    expect(res.statusCode).toBe(204)

    const updated = await testPrisma.user.findUnique({
      where: { id: target.id },
    })
    expect(updated?.isBanned).toBe(true)
    expect(updated?.bannedAt).not.toBeNull()
  })

  it('retorna 400 quando admin tenta banir a si mesmo', async () => {
    const admin = await makeAdmin()

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${admin.id}/ban`,
      headers: { authorization: `Bearer ${token(admin.id, 'ADMIN')}` },
      body: {},
    })

    expect(res.statusCode).toBe(400)
  })

  it('retorna 403 quando admin tenta banir outro admin', async () => {
    const admin = await makeAdmin()
    const otherAdmin = await makeAdmin()

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${otherAdmin.id}/ban`,
      headers: { authorization: `Bearer ${token(admin.id, 'ADMIN')}` },
      body: {},
    })

    expect(res.statusCode).toBe(403)
  })

  it('retorna 409 quando usuário já está banido', async () => {
    const admin = await makeAdmin()
    const target = await makeUser()
    await testPrisma.user.update({
      where: { id: target.id },
      data: { isBanned: true, bannedAt: new Date() },
    })

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${target.id}/ban`,
      headers: { authorization: `Bearer ${token(admin.id, 'ADMIN')}` },
      body: {},
    })

    expect(res.statusCode).toBe(409)
  })

  it('retorna 404 para usuário inexistente', async () => {
    const admin = await makeAdmin()

    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/users/00000000-0000-0000-0000-000000000000/ban',
      headers: { authorization: `Bearer ${token(admin.id, 'ADMIN')}` },
      body: {},
    })

    expect(res.statusCode).toBe(404)
  })

  it('retorna 403 quando usuário comum tenta banir', async () => {
    const user = await makeUser()
    const target = await makeUser()

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${target.id}/ban`,
      headers: { authorization: `Bearer ${token(user.id, 'USER')}` },
      body: {},
    })

    expect(res.statusCode).toBe(403)
  })

  it('retorna 401 sem token', async () => {
    const target = await makeUser()

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${target.id}/ban`,
      body: {},
    })

    expect(res.statusCode).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// PATCH /admin/users/:id/unban
// ---------------------------------------------------------------------------

describe('PATCH /admin/users/:id/unban', () => {
  it('admin desbane usuário banido com sucesso', async () => {
    const admin = await makeAdmin()
    const target = await makeUser()
    await testPrisma.user.update({
      where: { id: target.id },
      data: { isBanned: true, bannedAt: new Date() },
    })

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${target.id}/unban`,
      headers: { authorization: `Bearer ${token(admin.id, 'ADMIN')}` },
    })

    expect(res.statusCode).toBe(204)

    const updated = await testPrisma.user.findUnique({
      where: { id: target.id },
    })
    expect(updated?.isBanned).toBe(false)
    expect(updated?.bannedAt).toBeNull()
  })

  it('retorna 409 quando usuário não está banido', async () => {
    const admin = await makeAdmin()
    const target = await makeUser()

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${target.id}/unban`,
      headers: { authorization: `Bearer ${token(admin.id, 'ADMIN')}` },
    })

    expect(res.statusCode).toBe(409)
  })

  it('retorna 404 para usuário inexistente', async () => {
    const admin = await makeAdmin()

    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/users/00000000-0000-0000-0000-000000000000/unban',
      headers: { authorization: `Bearer ${token(admin.id, 'ADMIN')}` },
    })

    expect(res.statusCode).toBe(404)
  })

  it('retorna 403 quando usuário comum tenta desbanir', async () => {
    const user = await makeUser()
    const target = await makeUser()
    await testPrisma.user.update({
      where: { id: target.id },
      data: { isBanned: true, bannedAt: new Date() },
    })

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${target.id}/unban`,
      headers: { authorization: `Bearer ${token(user.id, 'USER')}` },
    })

    expect(res.statusCode).toBe(403)
  })

  it('retorna 401 sem token', async () => {
    const target = await makeUser()

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${target.id}/unban`,
    })

    expect(res.statusCode).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// DELETE /admin/events/:id
// ---------------------------------------------------------------------------

describe('DELETE /admin/events/:id', () => {
  it('admin deleta evento de outro usuário', async () => {
    const admin = await makeAdmin()
    const author = await makeUser()
    const event = await makeEvent(author.id)

    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/events/${event.id}`,
      headers: { authorization: `Bearer ${token(admin.id, 'ADMIN')}` },
    })

    expect(res.statusCode).toBe(204)

    const deleted = await testPrisma.event.findUnique({
      where: { id: event.id },
    })
    expect(deleted).toBeNull()
  })

  it('admin deleta o próprio evento', async () => {
    const admin = await makeAdmin()
    const event = await makeEvent(admin.id)

    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/events/${event.id}`,
      headers: { authorization: `Bearer ${token(admin.id, 'ADMIN')}` },
    })

    expect(res.statusCode).toBe(204)
  })

  it('retorna 404 para evento inexistente', async () => {
    const admin = await makeAdmin()

    const res = await app.inject({
      method: 'DELETE',
      url: '/admin/events/00000000-0000-0000-0000-000000000000',
      headers: { authorization: `Bearer ${token(admin.id, 'ADMIN')}` },
    })

    expect(res.statusCode).toBe(404)
  })

  it('retorna 403 quando usuário comum tenta deletar evento alheio', async () => {
    const user = await makeUser()
    const author = await makeUser()
    const event = await makeEvent(author.id)

    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/events/${event.id}`,
      headers: { authorization: `Bearer ${token(user.id, 'USER')}` },
    })

    expect(res.statusCode).toBe(403)
  })

  it('retorna 401 sem token', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id)

    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/events/${event.id}`,
    })

    expect(res.statusCode).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// GET /admin/reports
// ---------------------------------------------------------------------------

describe('GET /admin/reports', () => {
  it('admin lista denúncias com paginação', async () => {
    const admin = await makeAdmin()
    const author = await makeUser()
    const reporter = await makeUser()
    const event = await makeEvent(author.id)
    await makeReport(reporter.id, { eventId: event.id })

    const res = await app.inject({
      method: 'GET',
      url: '/admin/reports',
      headers: { authorization: `Bearer ${token(admin.id, 'ADMIN')}` },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveProperty('reports')
    expect(body).toHaveProperty('nextCursor')
    expect(Array.isArray(body.reports)).toBe(true)
    expect(body.reports.length).toBeGreaterThan(0)
  })

  it('admin filtra denúncias por status', async () => {
    const admin = await makeAdmin()
    const author = await makeUser()
    const reporter = await makeUser()
    const event = await makeEvent(author.id)
    await makeReport(reporter.id, { eventId: event.id, status: 'REVIEWED' })

    const res = await app.inject({
      method: 'GET',
      url: '/admin/reports?status=REVIEWED',
      headers: { authorization: `Bearer ${token(admin.id, 'ADMIN')}` },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(
      body.reports.every((r: { status: string }) => r.status === 'REVIEWED'),
    ).toBe(true)
  })

  it('respeita o limit e retorna nextCursor quando há mais resultados', async () => {
    const admin = await makeAdmin()
    const author = await makeUser()
    const reporter = await makeUser()

    const event1 = await makeEvent(author.id)
    const event2 = await makeEvent(author.id)
    await makeReport(reporter.id, { eventId: event1.id })
    await makeReport(reporter.id, { eventId: event2.id })

    const res = await app.inject({
      method: 'GET',
      url: '/admin/reports?limit=1',
      headers: { authorization: `Bearer ${token(admin.id, 'ADMIN')}` },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.reports).toHaveLength(1)
    expect(body.nextCursor).not.toBeNull()
  })

  it('retorna 403 quando usuário comum acessa', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: '/admin/reports',
      headers: { authorization: `Bearer ${token(user.id, 'USER')}` },
    })

    expect(res.statusCode).toBe(403)
  })

  it('retorna 401 sem token', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/reports' })
    expect(res.statusCode).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// GET /admin/reports/:id
// ---------------------------------------------------------------------------

describe('GET /admin/reports/:id', () => {
  it('admin busca denúncia de evento por ID', async () => {
    const admin = await makeAdmin()
    const author = await makeUser()
    const reporter = await makeUser()
    const event = await makeEvent(author.id)
    const report = await makeReport(reporter.id, { eventId: event.id })

    const res = await app.inject({
      method: 'GET',
      url: `/admin/reports/${report.id}`,
      headers: { authorization: `Bearer ${token(admin.id, 'ADMIN')}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      id: report.id,
      reporterId: reporter.id,
      eventId: event.id,
      status: 'PENDING',
    })
  })

  it('admin busca denúncia de comentário por ID', async () => {
    const admin = await makeAdmin()
    const author = await makeUser()
    const reporter = await makeUser()
    const event = await makeEvent(author.id)
    const comment = await makeComment(author.id, event.id)
    const report = await makeReport(reporter.id, { commentId: comment.id })

    const res = await app.inject({
      method: 'GET',
      url: `/admin/reports/${report.id}`,
      headers: { authorization: `Bearer ${token(admin.id, 'ADMIN')}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      id: report.id,
      commentId: comment.id,
    })
  })

  it('retorna 404 para denúncia inexistente', async () => {
    const admin = await makeAdmin()

    const res = await app.inject({
      method: 'GET',
      url: '/admin/reports/00000000-0000-0000-0000-000000000000',
      headers: { authorization: `Bearer ${token(admin.id, 'ADMIN')}` },
    })

    expect(res.statusCode).toBe(404)
  })

  it('retorna 403 quando usuário comum acessa', async () => {
    const user = await makeUser()
    const reporter = await makeUser()
    const author = await makeUser()
    const event = await makeEvent(author.id)
    const report = await makeReport(reporter.id, { eventId: event.id })

    const res = await app.inject({
      method: 'GET',
      url: `/admin/reports/${report.id}`,
      headers: { authorization: `Bearer ${token(user.id, 'USER')}` },
    })

    expect(res.statusCode).toBe(403)
  })

  it('retorna 401 sem token', async () => {
    const reporter = await makeUser()
    const author = await makeUser()
    const event = await makeEvent(author.id)
    const report = await makeReport(reporter.id, { eventId: event.id })

    const res = await app.inject({
      method: 'GET',
      url: `/admin/reports/${report.id}`,
    })

    expect(res.statusCode).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// PATCH /admin/reports/:id  (resolver denúncia)
// ---------------------------------------------------------------------------

describe('PATCH /admin/reports/:id', () => {
  it('admin resolve denúncia como REVIEWED', async () => {
    const admin = await makeAdmin()
    const author = await makeUser()
    const reporter = await makeUser()
    const event = await makeEvent(author.id)
    const report = await makeReport(reporter.id, { eventId: event.id })

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/reports/${report.id}`,
      headers: { authorization: `Bearer ${token(admin.id, 'ADMIN')}` },
      body: {
        status: 'REVIEWED',
        resolvedReason: 'Conteúdo revisado e considerado adequado',
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      id: report.id,
      status: 'REVIEWED',
      resolvedByAdminId: admin.id,
    })
  })

  it('admin resolve denúncia como RESOLVED_INVALID', async () => {
    const admin = await makeAdmin()
    const author = await makeUser()
    const reporter = await makeUser()
    const event = await makeEvent(author.id)
    const report = await makeReport(reporter.id, { eventId: event.id })

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/reports/${report.id}`,
      headers: { authorization: `Bearer ${token(admin.id, 'ADMIN')}` },
      body: { status: 'RESOLVED_INVALID' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('RESOLVED_INVALID')
  })

  it('admin resolve denúncia como RESOLVED_REMOVED e evento é deletado', async () => {
    const admin = await makeAdmin()
    const author = await makeUser()
    const reporter = await makeUser()
    const event = await makeEvent(author.id)
    const report = await makeReport(reporter.id, { eventId: event.id })

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/reports/${report.id}`,
      headers: { authorization: `Bearer ${token(admin.id, 'ADMIN')}` },
      body: {
        status: 'RESOLVED_REMOVED',
        resolvedReason: 'Evento com conteúdo proibido',
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('RESOLVED_REMOVED')

    const deletedEvent = await testPrisma.event.findUnique({
      where: { id: event.id },
    })
    expect(deletedEvent).toBeNull()
  })

  it('retorna 409 quando denúncia já foi resolvida', async () => {
    const admin = await makeAdmin()
    const author = await makeUser()
    const reporter = await makeUser()
    const event = await makeEvent(author.id)
    const report = await makeReport(reporter.id, {
      eventId: event.id,
      status: 'REVIEWED',
    })

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/reports/${report.id}`,
      headers: { authorization: `Bearer ${token(admin.id, 'ADMIN')}` },
      body: { status: 'RESOLVED_INVALID' },
    })

    expect(res.statusCode).toBe(409)
  })

  it('retorna 404 para denúncia inexistente', async () => {
    const admin = await makeAdmin()

    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/reports/00000000-0000-0000-0000-000000000000',
      headers: { authorization: `Bearer ${token(admin.id, 'ADMIN')}` },
      body: { status: 'REVIEWED' },
    })

    expect(res.statusCode).toBe(404)
  })

  it('retorna 403 quando usuário comum tenta resolver denúncia', async () => {
    const user = await makeUser()
    const author = await makeUser()
    const reporter = await makeUser()
    const event = await makeEvent(author.id)
    const report = await makeReport(reporter.id, { eventId: event.id })

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/reports/${report.id}`,
      headers: { authorization: `Bearer ${token(user.id, 'USER')}` },
      body: { status: 'REVIEWED' },
    })

    expect(res.statusCode).toBe(403)
  })

  it('retorna 401 sem token', async () => {
    const author = await makeUser()
    const reporter = await makeUser()
    const event = await makeEvent(author.id)
    const report = await makeReport(reporter.id, { eventId: event.id })

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/reports/${report.id}`,
      body: { status: 'REVIEWED' },
    })

    expect(res.statusCode).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// Efeitos colaterais do ban
// ---------------------------------------------------------------------------

describe('Efeitos colaterais: usuário banido', () => {
  it('usuário banido recebe 403 em rotas autenticadas', async () => {
    const target = await makeUser()
    await testPrisma.user.update({
      where: { id: target.id },
      data: { isBanned: true, bannedAt: new Date() },
    })

    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token(target.id, 'USER')}` },
    })

    expect(res.statusCode).toBe(403)
  })

  it('usuário banido não pode criar evento', async () => {
    const target = await makeUser()
    await testPrisma.user.update({
      where: { id: target.id },
      data: { isBanned: true, bannedAt: new Date() },
    })

    const res = await app.inject({
      method: 'POST',
      url: '/events',
      headers: { authorization: `Bearer ${token(target.id, 'USER')}` },
      body: {
        title: 'Festa',
        description: 'Desc',
        date: new Date(Date.now() + 86400000).toISOString(),
        latitude: -25.4,
        longitude: -49.3,
        category: 'Festa',
        isPublic: true,
      },
    })

    expect(res.statusCode).toBe(403)
  })

  it('usuário banido não aparece na listagem de usuários', async () => {
    const target = await makeUser()
    await testPrisma.user.update({
      where: { id: target.id },
      data: { isBanned: true, bannedAt: new Date() },
    })

    const res = await app.inject({ method: 'GET', url: '/users' })

    expect(res.statusCode).toBe(200)
    const ids = res.json().data.map((u: { id: string }) => u.id)
    expect(ids).not.toContain(target.id)
  })

  it('usuário volta a operar normalmente após ser desbanido', async () => {
    const admin = await makeAdmin()
    const target = await makeUser()

    await app.inject({
      method: 'PATCH',
      url: `/admin/users/${target.id}/ban`,
      headers: { authorization: `Bearer ${token(admin.id, 'ADMIN')}` },
      body: {},
    })

    const blockedRes = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token(target.id, 'USER')}` },
    })
    expect(blockedRes.statusCode).toBe(403)

    await app.inject({
      method: 'PATCH',
      url: `/admin/users/${target.id}/unban`,
      headers: { authorization: `Bearer ${token(admin.id, 'ADMIN')}` },
    })

    const restoredRes = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token(target.id, 'USER')}` },
    })
    expect(restoredRes.statusCode).toBe(200)
  })
})
