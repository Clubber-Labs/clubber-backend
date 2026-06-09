import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import {
  makeComment,
  makeDirectConversation,
  makeEvent,
  makeMessage,
  makeReport,
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

describe('POST /events/:eventId/report', () => {
  it('cria denúncia de evento com sucesso', async () => {
    const author = await makeUser()
    const reporter = await makeUser()
    const event = await makeEvent(author.id)

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/report`,
      headers: { authorization: `Bearer ${token(app, reporter.id)}` },
      body: { reason: 'SPAM_OR_FRAUD' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({
      reporterId: reporter.id,
      eventId: event.id,
      reason: 'SPAM_OR_FRAUD',
    })
  })

  it('retorna 401 sem autenticação', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id)

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/report`,
      body: { reason: 'SPAM_OR_FRAUD' },
    })

    expect(res.statusCode).toBe(401)
  })

  it('retorna 404 para evento inexistente', async () => {
    const reporter = await makeUser()

    const res = await app.inject({
      method: 'POST',
      url: '/events/00000000-0000-0000-0000-000000000000/report',
      headers: { authorization: `Bearer ${token(app, reporter.id)}` },
      body: { reason: 'SPAM_OR_FRAUD' },
    })

    expect(res.statusCode).toBe(404)
  })

  it('retorna 400 quando autor denuncia o próprio evento', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id)

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/report`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: { reason: 'SPAM_OR_FRAUD' },
    })

    expect(res.statusCode).toBe(400)
  })

  it('retorna 409 quando já existe denúncia ativa para o mesmo evento', async () => {
    const author = await makeUser()
    const reporter = await makeUser()
    const event = await makeEvent(author.id)
    await makeReport(reporter.id, { eventId: event.id })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/report`,
      headers: { authorization: `Bearer ${token(app, reporter.id)}` },
      body: { reason: 'HARASSMENT' },
    })

    expect(res.statusCode).toBe(409)
  })

  it('retorna 403 para evento privado sem acesso', async () => {
    const author = await makeUser()
    const reporter = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/report`,
      headers: { authorization: `Bearer ${token(app, reporter.id)}` },
      body: { reason: 'SPAM_OR_FRAUD' },
    })

    expect(res.statusCode).toBe(403)
  })
})

describe('POST /messages/:messageId/report', () => {
  it('participante denuncia mensagem de outro (201)', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    const message = await makeMessage(convo.id, a.id, { content: 'spam' })

    const res = await app.inject({
      method: 'POST',
      url: `/messages/${message.id}/report`,
      headers: { authorization: `Bearer ${token(app, b.id)}` },
      body: { reason: 'SPAM_OR_FRAUD' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({
      reporterId: b.id,
      messageId: message.id,
      reason: 'SPAM_OR_FRAUD',
    })
  })

  it('409 ao denunciar a mesma mensagem duas vezes', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    const message = await makeMessage(convo.id, a.id, { content: 'spam' })

    const first = await app.inject({
      method: 'POST',
      url: `/messages/${message.id}/report`,
      headers: { authorization: `Bearer ${token(app, b.id)}` },
      body: { reason: 'SPAM_OR_FRAUD' },
    })
    expect(first.statusCode).toBe(201)

    const second = await app.inject({
      method: 'POST',
      url: `/messages/${message.id}/report`,
      headers: { authorization: `Bearer ${token(app, b.id)}` },
      body: { reason: 'HARASSMENT' },
    })
    expect(second.statusCode).toBe(409)
  })

  it('403 ao denunciar mensagem de conversa onde não participa', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const stranger = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    const message = await makeMessage(convo.id, a.id, { content: 'oi' })

    const res = await app.inject({
      method: 'POST',
      url: `/messages/${message.id}/report`,
      headers: { authorization: `Bearer ${token(app, stranger.id)}` },
      body: { reason: 'SPAM_OR_FRAUD' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('404 para mensagem inexistente', async () => {
    const reporter = await makeUser()
    const res = await app.inject({
      method: 'POST',
      url: '/messages/00000000-0000-0000-0000-000000000000/report',
      headers: { authorization: `Bearer ${token(app, reporter.id)}` },
      body: { reason: 'SPAM_OR_FRAUD' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('400 ao denunciar a própria mensagem', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    const message = await makeMessage(convo.id, a.id, { content: 'minha' })

    const res = await app.inject({
      method: 'POST',
      url: `/messages/${message.id}/report`,
      headers: { authorization: `Bearer ${token(app, a.id)}` },
      body: { reason: 'SPAM_OR_FRAUD' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /comments/:commentId/report', () => {
  it('cria denúncia de comentário com sucesso', async () => {
    const author = await makeUser()
    const reporter = await makeUser()
    const event = await makeEvent(author.id)
    const comment = await makeComment(author.id, event.id)

    const res = await app.inject({
      method: 'POST',
      url: `/comments/${comment.id}/report`,
      headers: { authorization: `Bearer ${token(app, reporter.id)}` },
      body: { reason: 'HATE_SPEECH', details: 'Conteúdo ofensivo' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({
      reporterId: reporter.id,
      commentId: comment.id,
      reason: 'HATE_SPEECH',
    })
  })

  it('retorna 401 sem autenticação', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id)
    const comment = await makeComment(author.id, event.id)

    const res = await app.inject({
      method: 'POST',
      url: `/comments/${comment.id}/report`,
      body: { reason: 'SPAM_OR_FRAUD' },
    })

    expect(res.statusCode).toBe(401)
  })

  it('retorna 404 para comentário inexistente', async () => {
    const reporter = await makeUser()

    const res = await app.inject({
      method: 'POST',
      url: '/comments/00000000-0000-0000-0000-000000000000/report',
      headers: { authorization: `Bearer ${token(app, reporter.id)}` },
      body: { reason: 'SPAM_OR_FRAUD' },
    })

    expect(res.statusCode).toBe(404)
  })

  it('retorna 400 quando autor denuncia o próprio comentário', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id)
    const comment = await makeComment(author.id, event.id)

    const res = await app.inject({
      method: 'POST',
      url: `/comments/${comment.id}/report`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: { reason: 'SPAM_OR_FRAUD' },
    })

    expect(res.statusCode).toBe(400)
  })

  it('retorna 409 quando já existe denúncia ativa para o mesmo comentário', async () => {
    const author = await makeUser()
    const reporter = await makeUser()
    const event = await makeEvent(author.id)
    const comment = await makeComment(author.id, event.id)
    await makeReport(reporter.id, { commentId: comment.id })

    const res = await app.inject({
      method: 'POST',
      url: `/comments/${comment.id}/report`,
      headers: { authorization: `Bearer ${token(app, reporter.id)}` },
      body: { reason: 'INAPPROPRIATE_CONTENT' },
    })

    expect(res.statusCode).toBe(409)
  })
})

describe('POST /users/:userId/report', () => {
  it('cria denúncia de usuário com sucesso', async () => {
    const target = await makeUser()
    const reporter = await makeUser()

    const res = await app.inject({
      method: 'POST',
      url: `/users/${target.id}/report`,
      headers: { authorization: `Bearer ${token(app, reporter.id)}` },
      body: { reason: 'HARASSMENT', details: 'Perfil abusivo' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({
      reporterId: reporter.id,
      targetUserId: target.id,
      reason: 'HARASSMENT',
    })
  })

  it('retorna 400 quando usuário denuncia a si mesmo', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'POST',
      url: `/users/${user.id}/report`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { reason: 'SPAM_OR_FRAUD' },
    })

    expect(res.statusCode).toBe(400)
  })

  it('retorna 409 quando já existe denúncia ativa para o mesmo usuário', async () => {
    const target = await makeUser()
    const reporter = await makeUser()
    await makeReport(reporter.id, { targetUserId: target.id })

    const res = await app.inject({
      method: 'POST',
      url: `/users/${target.id}/report`,
      headers: { authorization: `Bearer ${token(app, reporter.id)}` },
      body: { reason: 'INAPPROPRIATE_CONTENT' },
    })

    expect(res.statusCode).toBe(409)
  })
})

describe('GET /reports', () => {
  it('lista denúncias para administrador com filtros', async () => {
    const admin = await makeUser({ role: 'ADMIN' })
    const author = await makeUser()
    const reporter = await makeUser()
    const target = await makeUser()
    const event = await makeEvent(author.id)
    const eventReport = await makeReport(reporter.id, { eventId: event.id })
    await makeReport(reporter.id, {
      targetUserId: target.id,
      status: 'RESOLVED_INVALID',
    })

    const res = await app.inject({
      method: 'GET',
      url: '/reports?status=PENDING&targetType=EVENT',
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      data: [
        {
          id: eventReport.id,
          reporterId: reporter.id,
          eventId: event.id,
          status: 'PENDING',
          reporter: { id: reporter.id },
          event: { id: event.id },
        },
      ],
      nextCursor: null,
    })
  })

  it('retorna 403 para usuário comum', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: '/reports',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(403)
  })
})

describe('GET /reports/:id', () => {
  it('detalha uma denúncia para administrador', async () => {
    const admin = await makeUser({ role: 'ADMIN' })
    const author = await makeUser()
    const reporter = await makeUser()
    const event = await makeEvent(author.id)
    const report = await makeReport(reporter.id, { eventId: event.id })

    const res = await app.inject({
      method: 'GET',
      url: `/reports/${report.id}`,
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      id: report.id,
      reporterId: reporter.id,
      eventId: event.id,
      reporter: { id: reporter.id },
      event: { id: event.id },
    })
  })

  it('retorna 403 para usuário comum', async () => {
    const user = await makeUser()
    const reporter = await makeUser()
    const target = await makeUser()
    const report = await makeReport(reporter.id, { targetUserId: target.id })

    const res = await app.inject({
      method: 'GET',
      url: `/reports/${report.id}`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(403)
  })
})

describe('PATCH /reports/:id', () => {
  it('resolve uma denúncia como administrador', async () => {
    const admin = await makeUser({ role: 'ADMIN' })
    const author = await makeUser()
    const reporter = await makeUser()
    const event = await makeEvent(author.id)
    const report = await makeReport(reporter.id, { eventId: event.id })

    const res = await app.inject({
      method: 'PATCH',
      url: `/reports/${report.id}`,
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
      body: {
        status: 'RESOLVED_REMOVED',
        resolutionNote: 'Conteúdo removido pela moderação',
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      id: report.id,
      status: 'RESOLVED_REMOVED',
      reviewerId: admin.id,
      resolutionNote: 'Conteúdo removido pela moderação',
    })
    expect(res.json().resolvedAt).toBeTruthy()

    const stored = await testPrisma.report.findUnique({
      where: { id: report.id },
    })
    expect(stored?.status).toBe('RESOLVED_REMOVED')
    expect(stored?.reviewerId).toBe(admin.id)
    expect(stored?.resolvedAt).toBeTruthy()
  })

  it('retorna 403 para usuário comum', async () => {
    const user = await makeUser()
    const reporter = await makeUser()
    const target = await makeUser()
    const report = await makeReport(reporter.id, { targetUserId: target.id })

    const res = await app.inject({
      method: 'PATCH',
      url: `/reports/${report.id}`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { status: 'REVIEWED' },
    })

    expect(res.statusCode).toBe(403)
  })

  it('retorna 404 para denúncia inexistente', async () => {
    const admin = await makeUser({ role: 'ADMIN' })

    const res = await app.inject({
      method: 'PATCH',
      url: '/reports/00000000-0000-0000-0000-000000000000',
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
      body: { status: 'REVIEWED' },
    })

    expect(res.statusCode).toBe(404)
  })
})

describe('DELETE /reports/:id/target', () => {
  it('remove evento denunciado e marca a denúncia como resolvida com remoção', async () => {
    const admin = await makeUser({ role: 'ADMIN' })
    const author = await makeUser()
    const reporter = await makeUser()
    const event = await makeEvent(author.id)
    const report = await makeReport(reporter.id, { eventId: event.id })

    const res = await app.inject({
      method: 'DELETE',
      url: `/reports/${report.id}/target`,
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      id: report.id,
      status: 'RESOLVED_REMOVED',
      reviewerId: admin.id,
      eventId: null,
      resolutionNote: 'Conteúdo removido pela moderação',
    })

    await expect(
      testPrisma.event.findUnique({ where: { id: event.id } }),
    ).resolves.toBeNull()
  })

  it('remove comentário denunciado e preserva a denúncia como evidência', async () => {
    const admin = await makeUser({ role: 'ADMIN' })
    const author = await makeUser()
    const reporter = await makeUser()
    const event = await makeEvent(author.id)
    const comment = await makeComment(author.id, event.id, 'ofensivo')
    const report = await makeReport(reporter.id, { commentId: comment.id })

    const res = await app.inject({
      method: 'DELETE',
      url: `/reports/${report.id}/target`,
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      id: report.id,
      status: 'RESOLVED_REMOVED',
      reviewerId: admin.id,
      commentId: null,
    })

    await expect(
      testPrisma.comment.findUnique({ where: { id: comment.id } }),
    ).resolves.toBeNull()
  })

  it('apaga mensagem denunciada com soft delete', async () => {
    const admin = await makeUser({ role: 'ADMIN' })
    const sender = await makeUser()
    const reporter = await makeUser()
    const convo = await makeDirectConversation(sender.id, reporter.id)
    const message = await makeMessage(convo.id, sender.id, {
      content: 'mensagem abusiva',
    })
    const report = await makeReport(reporter.id, { messageId: message.id })

    const res = await app.inject({
      method: 'DELETE',
      url: `/reports/${report.id}/target`,
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      id: report.id,
      status: 'RESOLVED_REMOVED',
      reviewerId: admin.id,
      messageId: message.id,
    })

    const stored = await testPrisma.message.findUnique({
      where: { id: message.id },
    })
    expect(stored?.deletedAt).toBeTruthy()
  })

  it('não remove usuário pelo painel de denúncias', async () => {
    const admin = await makeUser({ role: 'ADMIN' })
    const reporter = await makeUser()
    const target = await makeUser()
    const report = await makeReport(reporter.id, { targetUserId: target.id })

    const res = await app.inject({
      method: 'DELETE',
      url: `/reports/${report.id}/target`,
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
    })

    expect(res.statusCode).toBe(400)

    await expect(
      testPrisma.user.findUnique({ where: { id: target.id } }),
    ).resolves.not.toBeNull()
  })

  it('retorna 403 para usuário comum', async () => {
    const user = await makeUser()
    const author = await makeUser()
    const reporter = await makeUser()
    const event = await makeEvent(author.id)
    const report = await makeReport(reporter.id, { eventId: event.id })

    const res = await app.inject({
      method: 'DELETE',
      url: `/reports/${report.id}/target`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(403)

    await expect(
      testPrisma.event.findUnique({ where: { id: event.id } }),
    ).resolves.not.toBeNull()
  })

  it('retorna 401 sem autenticação', async () => {
    const author = await makeUser()
    const reporter = await makeUser()
    const event = await makeEvent(author.id)
    const report = await makeReport(reporter.id, { eventId: event.id })

    const res = await app.inject({
      method: 'DELETE',
      url: `/reports/${report.id}/target`,
    })

    expect(res.statusCode).toBe(401)
  })

  it('retorna 404 para denúncia inexistente', async () => {
    const admin = await makeUser({ role: 'ADMIN' })

    const res = await app.inject({
      method: 'DELETE',
      url: '/reports/00000000-0000-0000-0000-000000000000/target',
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
    })

    expect(res.statusCode).toBe(404)
  })

  it('retorna 409 quando conteúdo já foi removido por cascata', async () => {
    const admin = await makeUser({ role: 'ADMIN' })
    const author = await makeUser()
    const reporter = await makeUser()
    const event = await makeEvent(author.id)
    const report = await makeReport(reporter.id, { eventId: event.id })
    await testPrisma.event.delete({ where: { id: event.id } })

    const res = await app.inject({
      method: 'DELETE',
      url: `/reports/${report.id}/target`,
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
    })

    expect(res.statusCode).toBe(409)
  })
})

describe('DELETE /reports/:id', () => {
  it('remove uma denúncia como administrador', async () => {
    const admin = await makeUser({ role: 'ADMIN' })
    const reporter = await makeUser()
    const target = await makeUser()
    const report = await makeReport(reporter.id, { targetUserId: target.id })

    const res = await app.inject({
      method: 'DELETE',
      url: `/reports/${report.id}`,
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
    })

    expect(res.statusCode).toBe(204)

    const stored = await testPrisma.report.findUnique({
      where: { id: report.id },
    })
    expect(stored).toBeNull()
  })

  it('retorna 403 para usuário comum', async () => {
    const user = await makeUser()
    const reporter = await makeUser()
    const target = await makeUser()
    const report = await makeReport(reporter.id, { targetUserId: target.id })

    const res = await app.inject({
      method: 'DELETE',
      url: `/reports/${report.id}`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(403)

    const stored = await testPrisma.report.findUnique({
      where: { id: report.id },
    })
    expect(stored).not.toBeNull()
  })

  it('retorna 401 sem autenticação', async () => {
    const reporter = await makeUser()
    const target = await makeUser()
    const report = await makeReport(reporter.id, { targetUserId: target.id })

    const res = await app.inject({
      method: 'DELETE',
      url: `/reports/${report.id}`,
    })

    expect(res.statusCode).toBe(401)
  })

  it('retorna 404 para denúncia inexistente', async () => {
    const admin = await makeUser({ role: 'ADMIN' })

    const res = await app.inject({
      method: 'DELETE',
      url: '/reports/00000000-0000-0000-0000-000000000000',
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
    })

    expect(res.statusCode).toBe(404)
  })
})
