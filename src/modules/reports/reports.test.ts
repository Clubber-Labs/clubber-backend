import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { block } from '../../lib/moderation-denylist'
import { buildApp } from '../../test/app'
import {
  makeBlock,
  makeComment,
  makeDirectConversation,
  makeEvent,
  makeFollow,
  makeMessage,
  makePost,
  makeReport,
  makeSpot,
  makeUser,
  makeUserPhoto,
} from '../../test/factories'
import { fakeStorage } from '../../test/fake-storage'
import { testPrisma } from '../../test/prisma'
import { reconcileSuspensions } from '../users/suspension.reconciler'

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

describe('POST /posts/:postId/report', () => {
  it('cria denúncia de post com sucesso', async () => {
    const author = await makeUser()
    const reporter = await makeUser()
    const event = await makeEvent(author.id)
    const post = await makePost(author.id, event.id)

    const res = await app.inject({
      method: 'POST',
      url: `/posts/${post.id}/report`,
      headers: { authorization: `Bearer ${token(app, reporter.id)}` },
      body: { reason: 'INAPPROPRIATE_CONTENT', details: 'Imagem imprópria' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({
      reporterId: reporter.id,
      postId: post.id,
      reason: 'INAPPROPRIATE_CONTENT',
    })
  })

  it('retorna 401 sem autenticação', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id)
    const post = await makePost(author.id, event.id)

    const res = await app.inject({
      method: 'POST',
      url: `/posts/${post.id}/report`,
      body: { reason: 'SPAM_OR_FRAUD' },
    })

    expect(res.statusCode).toBe(401)
  })

  it('retorna 404 para post inexistente', async () => {
    const reporter = await makeUser()

    const res = await app.inject({
      method: 'POST',
      url: '/posts/00000000-0000-0000-0000-000000000000/report',
      headers: { authorization: `Bearer ${token(app, reporter.id)}` },
      body: { reason: 'SPAM_OR_FRAUD' },
    })

    expect(res.statusCode).toBe(404)
  })

  it('retorna 400 quando autor denuncia o próprio post', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id)
    const post = await makePost(author.id, event.id)

    const res = await app.inject({
      method: 'POST',
      url: `/posts/${post.id}/report`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: { reason: 'SPAM_OR_FRAUD' },
    })

    expect(res.statusCode).toBe(400)
  })

  it('retorna 409 quando já existe denúncia ativa para o mesmo post', async () => {
    const author = await makeUser()
    const reporter = await makeUser()
    const event = await makeEvent(author.id)
    const post = await makePost(author.id, event.id)
    await makeReport(reporter.id, { postId: post.id })

    const res = await app.inject({
      method: 'POST',
      url: `/posts/${post.id}/report`,
      headers: { authorization: `Bearer ${token(app, reporter.id)}` },
      body: { reason: 'HATE_SPEECH' },
    })

    expect(res.statusCode).toBe(409)
  })

  it('admin vê o post denunciado com suas imagens em GET /reports/:id', async () => {
    const admin = await makeUser({ role: 'ADMIN' })
    const author = await makeUser()
    const reporter = await makeUser()
    const event = await makeEvent(author.id)
    const post = await makePost(author.id, event.id, { content: 'Olha isso' })
    await testPrisma.postImage.create({
      data: {
        url: 'https://fake.storage/posts/x/0.webp',
        key: 'posts/x/0.webp',
        format: 'webp',
        size: 100,
        order: 0,
        postId: post.id,
      },
    })
    const report = await makeReport(reporter.id, { postId: post.id })

    const res = await app.inject({
      method: 'GET',
      url: `/reports/${report.id}`,
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().post).toMatchObject({
      id: post.id,
      content: 'Olha isso',
      author: { id: author.id },
      event: { id: event.id },
    })
    expect(res.json().post.images).toHaveLength(1)
    expect(res.json().post.images[0]).toMatchObject({ format: 'webp' })
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

describe('POST /reports/:id/moderate-user', () => {
  async function reportedUser() {
    const admin = await makeUser({ role: 'ADMIN' })
    const reporter = await makeUser()
    const target = await makeUser()
    const report = await makeReport(reporter.id, { targetUserId: target.id })
    return { admin, target, report }
  }

  it('suspende o usuário denunciado (admin) e resolve a denúncia', async () => {
    const { admin, target, report } = await reportedUser()

    const res = await app.inject({
      method: 'POST',
      url: `/reports/${report.id}/moderate-user`,
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
      body: { action: 'SUSPEND', days: 7, reason: 'assédio' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      id: report.id,
      status: 'RESOLVED_SUSPENDED',
      reviewerId: admin.id,
    })

    const stored = await testPrisma.user.findUnique({
      where: { id: target.id },
      select: {
        accountStatus: true,
        suspendedUntil: true,
        suspensionReason: true,
      },
    })
    expect(stored?.accountStatus).toBe('SUSPENDED')
    expect(stored?.suspendedUntil).toBeTruthy()
    expect(stored?.suspensionReason).toBe('assédio')
  })

  it('bane permanentemente e resolve como RESOLVED_BANNED', async () => {
    const { admin, target, report } = await reportedUser()

    const res = await app.inject({
      method: 'POST',
      url: `/reports/${report.id}/moderate-user`,
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
      body: { action: 'BAN', reason: 'reincidência' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('RESOLVED_BANNED')

    const stored = await testPrisma.user.findUnique({
      where: { id: target.id },
      select: { accountStatus: true, suspendedUntil: true },
    })
    expect(stored?.accountStatus).toBe('BANNED')
    expect(stored?.suspendedUntil).toBeNull()
  })

  it('exige days quando action=SUSPEND (400)', async () => {
    const { admin, report } = await reportedUser()
    const res = await app.inject({
      method: 'POST',
      url: `/reports/${report.id}/moderate-user`,
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
      body: { action: 'SUSPEND' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('409 ao suspender quem já está banido (não rebaixa o ban)', async () => {
    const admin = await makeUser({ role: 'ADMIN' })
    // Dois reporters distintos: a unique [reporterId, targetUserId, status]
    // impede o mesmo reporter ter duas denúncias ativas sobre o mesmo alvo.
    const reporterA = await makeUser()
    const reporterB = await makeUser()
    const target = await makeUser()
    const banReport = await makeReport(reporterA.id, {
      targetUserId: target.id,
    })
    const suspendReport = await makeReport(reporterB.id, {
      targetUserId: target.id,
    })

    const ban = await app.inject({
      method: 'POST',
      url: `/reports/${banReport.id}/moderate-user`,
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
      body: { action: 'BAN', reason: 'reincidência' },
    })
    expect(ban.statusCode).toBe(200)

    const res = await app.inject({
      method: 'POST',
      url: `/reports/${suspendReport.id}/moderate-user`,
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
      body: { action: 'SUSPEND', days: 1 },
    })
    expect(res.statusCode).toBe(409)

    // O banimento permanente é preservado (sem suspendedUntil).
    const stored = await testPrisma.user.findUnique({
      where: { id: target.id },
      select: { accountStatus: true, suspendedUntil: true },
    })
    expect(stored?.accountStatus).toBe('BANNED')
    expect(stored?.suspendedUntil).toBeNull()
  })

  it('400 quando a denúncia não é sobre usuário', async () => {
    const admin = await makeUser({ role: 'ADMIN' })
    const author = await makeUser()
    const reporter = await makeUser()
    const event = await makeEvent(author.id)
    const report = await makeReport(reporter.id, { eventId: event.id })

    const res = await app.inject({
      method: 'POST',
      url: `/reports/${report.id}/moderate-user`,
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
      body: { action: 'BAN' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('403 ao moderar outro administrador', async () => {
    const admin = await makeUser({ role: 'ADMIN' })
    const otherAdmin = await makeUser({ role: 'ADMIN' })
    const reporter = await makeUser()
    const report = await makeReport(reporter.id, {
      targetUserId: otherAdmin.id,
    })

    const res = await app.inject({
      method: 'POST',
      url: `/reports/${report.id}/moderate-user`,
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
      body: { action: 'BAN' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('403 para usuário comum', async () => {
    const { target, report } = await reportedUser()
    const user = await makeUser()
    const res = await app.inject({
      method: 'POST',
      url: `/reports/${report.id}/moderate-user`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { action: 'BAN' },
    })
    expect(res.statusCode).toBe(403)
    const stored = await testPrisma.user.findUnique({
      where: { id: target.id },
      select: { accountStatus: true },
    })
    expect(stored?.accountStatus).toBe('ACTIVE')
  })
})

describe('Enforcement de suspensão/banimento', () => {
  async function suspendViaApi(days = 7) {
    const admin = await makeUser({ role: 'ADMIN' })
    const reporter = await makeUser()
    const target = await makeUser()
    const report = await makeReport(reporter.id, { targetUserId: target.id })
    await app.inject({
      method: 'POST',
      url: `/reports/${report.id}/moderate-user`,
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
      body: { action: 'SUSPEND', days },
    })
    return { admin, target }
  }

  it('barra a sessão existente do suspenso (401 no authenticate)', async () => {
    const { target } = await suspendViaApi()
    const res = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { authorization: `Bearer ${token(app, target.id)}` },
    })
    expect(res.statusCode).toBe(401)
  })

  it('usuário suspenso não consegue logar (403)', async () => {
    const { target } = await suspendViaApi()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      body: { email: target.email, password: 'senha123' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('suspenso some da busca de usuários', async () => {
    const searcher = await makeUser()
    const { target } = await suspendViaApi()
    const res = await app.inject({
      method: 'GET',
      url: `/users/search?q=${target.username}`,
      headers: { authorization: `Bearer ${token(app, searcher.id)}` },
    })
    expect(res.statusCode).toBe(200)
    const ids = (res.json().data ?? res.json()).map((u: { id: string }) => u.id)
    expect(ids).not.toContain(target.id)
  })

  it('unsuspend reativa: volta a logar e a sessão funciona', async () => {
    const { admin, target } = await suspendViaApi()

    const lift = await app.inject({
      method: 'POST',
      url: `/moderation/users/${target.id}/unsuspend`,
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
    })
    expect(lift.statusCode).toBe(200)

    const me = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { authorization: `Bearer ${token(app, target.id)}` },
    })
    expect(me.statusCode).toBe(200)

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      body: { email: target.email, password: 'senha123' },
    })
    expect(login.statusCode).toBe(200)
  })
})

describe('Expiração de suspensão', () => {
  async function suspendedInPast() {
    const user = await makeUser()
    await testPrisma.user.update({
      where: { id: user.id },
      data: {
        accountStatus: 'SUSPENDED',
        suspendedAt: new Date(Date.now() - 2 * 86400000),
        suspendedUntil: new Date(Date.now() - 86400000),
        suspensionReason: 'expirando',
      },
    })
    await block(user.id)
    return user
  }

  it('reconciler expira suspensão vencida → ACTIVE', async () => {
    const user = await suspendedInPast()

    const result = await reconcileSuspensions(new Date())
    expect(result.unsuspended).toBeGreaterThanOrEqual(1)

    const stored = await testPrisma.user.findUnique({
      where: { id: user.id },
      select: { accountStatus: true, suspendedUntil: true },
    })
    expect(stored?.accountStatus).toBe('ACTIVE')
    expect(stored?.suspendedUntil).toBeNull()

    const me = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })
    expect(me.statusCode).toBe(200)
  })

  it('login auto-cura suspensão vencida', async () => {
    const user = await suspendedInPast()

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      body: { email: user.email, password: 'senha123' },
    })
    expect(res.statusCode).toBe(200)

    const stored = await testPrisma.user.findUnique({
      where: { id: user.id },
      select: { accountStatus: true },
    })
    expect(stored?.accountStatus).toBe('ACTIVE')
  })
})

// Antes disso o rolê era inalcançável pela moderação: o menu do card do app
// oferecia "denunciar usuário" com o id do criador, e o conteúdo do rolê
// (título, descrição, local) nunca chegava a quem revisa.
describe('POST /spots/:spotId/report', () => {
  it('cria denúncia de rolê com targetType SPOT', async () => {
    const creator = await makeUser()
    const reporter = await makeUser()
    const spot = await makeSpot(creator.id)

    const res = await app.inject({
      method: 'POST',
      url: `/spots/${spot.id}/report`,
      headers: { authorization: `Bearer ${token(app, reporter.id)}` },
      body: { reason: 'HATE_SPEECH', details: 'Título ofensivo' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({
      spotId: spot.id,
      reporterId: reporter.id,
      reason: 'HATE_SPEECH',
      status: 'PENDING',
    })
    // O criador NÃO é o alvo: o alvo é o rolê.
    expect(res.json().targetUserId).toBeNull()
  })

  it('aceita o alias plural /spots/:spotId/reports', async () => {
    const creator = await makeUser()
    const reporter = await makeUser()
    const spot = await makeSpot(creator.id)

    const res = await app.inject({
      method: 'POST',
      url: `/spots/${spot.id}/reports`,
      headers: { authorization: `Bearer ${token(app, reporter.id)}` },
      body: { reason: 'SPAM_OR_FRAUD' },
    })

    expect(res.statusCode).toBe(201)
  })

  it('retorna 400 ao denunciar o próprio rolê', async () => {
    const creator = await makeUser()
    const spot = await makeSpot(creator.id)

    const res = await app.inject({
      method: 'POST',
      url: `/spots/${spot.id}/report`,
      headers: { authorization: `Bearer ${token(app, creator.id)}` },
      body: { reason: 'OTHER' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('SELF_REPORT')
  })

  it('retorna 409 na segunda denúncia aberta do mesmo rolê', async () => {
    const creator = await makeUser()
    const reporter = await makeUser()
    const spot = await makeSpot(creator.id)
    const headers = { authorization: `Bearer ${token(app, reporter.id)}` }

    await app.inject({
      method: 'POST',
      url: `/spots/${spot.id}/report`,
      headers,
      body: { reason: 'HARASSMENT' },
    })
    const res = await app.inject({
      method: 'POST',
      url: `/spots/${spot.id}/report`,
      headers,
      body: { reason: 'HARASSMENT' },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('REPORT_ALREADY_OPEN')
  })

  it('retorna 404 para rolê inexistente', async () => {
    const reporter = await makeUser()

    const res = await app.inject({
      method: 'POST',
      url: '/spots/00000000-0000-4000-8000-000000000000/report',
      headers: { authorization: `Bearer ${token(app, reporter.id)}` },
      body: { reason: 'OTHER' },
    })

    expect(res.statusCode).toBe(404)
  })

  // Mesma régua do GET /spots/:id: privacidade fica atrás de 404, não vaza
  // existência de rolê de amigos para quem não é amigo.
  it('retorna 404 em rolê FRIENDS sem amizade mútua', async () => {
    const creator = await makeUser()
    const stranger = await makeUser()
    const spot = await makeSpot(creator.id, { visibility: 'FRIENDS' })

    const res = await app.inject({
      method: 'POST',
      url: `/spots/${spot.id}/report`,
      headers: { authorization: `Bearer ${token(app, stranger.id)}` },
      body: { reason: 'OTHER' },
    })

    expect(res.statusCode).toBe(404)
  })

  it('retorna 401 sem autenticação', async () => {
    const creator = await makeUser()
    const spot = await makeSpot(creator.id)

    const res = await app.inject({
      method: 'POST',
      url: `/spots/${spot.id}/report`,
      body: { reason: 'OTHER' },
    })

    expect(res.statusCode).toBe(401)
  })

  // Denúncia é gatilho de moderação: sem teto, vira vetor de flood na fila de
  // quem revisa. Mesmo teto dos outros alvos (createReportRouteConfig).
  it('aplica o rate limit de 20 por minuto', async () => {
    const creator = await makeUser()
    const reporter = await makeUser()
    const spot = await makeSpot(creator.id)
    const headers = { authorization: `Bearer ${token(app, reporter.id)}` }
    const body = { reason: 'OTHER' }

    // A 1ª cria (201) e as demais batem no 409 de denúncia já aberta — o que
    // importa é que o limitador conta a requisição, não o status dela.
    for (let i = 0; i < 20; i++) {
      const res = await app.inject({
        method: 'POST',
        url: `/spots/${spot.id}/report`,
        headers,
        body,
      })
      expect(res.statusCode).not.toBe(429)
    }

    const blocked = await app.inject({
      method: 'POST',
      url: `/spots/${spot.id}/report`,
      headers,
      body,
    })
    expect(blocked.statusCode).toBe(429)
  })
})

describe('moderação de denúncia de rolê', () => {
  it('filtra por targetType=SPOT em GET /reports', async () => {
    const admin = await makeUser({ role: 'ADMIN' })
    const creator = await makeUser()
    const reporter = await makeUser()
    const spot = await makeSpot(creator.id)
    const event = await makeEvent(creator.id)
    await app.inject({
      method: 'POST',
      url: `/spots/${spot.id}/report`,
      headers: { authorization: `Bearer ${token(app, reporter.id)}` },
      body: { reason: 'OTHER' },
    })
    await app.inject({
      method: 'POST',
      url: `/events/${event.id}/report`,
      headers: { authorization: `Bearer ${token(app, reporter.id)}` },
      body: { reason: 'OTHER' },
    })

    const res = await app.inject({
      method: 'GET',
      url: '/reports?targetType=SPOT',
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
    expect(res.json().data[0].spotId).toBe(spot.id)
  })

  // Cancelar é o primitivo de "tirar de circulação" do rolê: some do feed, da
  // lista e da descoberta, e o grupo de chat (prova das outras denúncias) fica.
  it('DELETE /reports/:id/target cancela o rolê denunciado', async () => {
    const admin = await makeUser({ role: 'ADMIN' })
    const creator = await makeUser()
    const reporter = await makeUser()
    const spot = await makeSpot(creator.id)
    const created = await app.inject({
      method: 'POST',
      url: `/spots/${spot.id}/report`,
      headers: { authorization: `Bearer ${token(app, reporter.id)}` },
      body: { reason: 'HATE_SPEECH' },
    })

    const res = await app.inject({
      method: 'DELETE',
      url: `/reports/${created.json().id}/target`,
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('RESOLVED_REMOVED')
    const after = await testPrisma.spot.findUnique({ where: { id: spot.id } })
    expect(after?.canceledAt).not.toBeNull()
  })

  it('rolê cancelado pela moderação some da listagem', async () => {
    const admin = await makeUser({ role: 'ADMIN' })
    const creator = await makeUser()
    const reporter = await makeUser()
    const spot = await makeSpot(creator.id)
    const created = await app.inject({
      method: 'POST',
      url: `/spots/${spot.id}/report`,
      headers: { authorization: `Bearer ${token(app, reporter.id)}` },
      body: { reason: 'HATE_SPEECH' },
    })
    await app.inject({
      method: 'DELETE',
      url: `/reports/${created.json().id}/target`,
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
    })

    const res = await app.inject({
      method: 'GET',
      url: '/spots/mine',
      headers: { authorization: `Bearer ${token(app, creator.id)}` },
    })

    expect(res.json().map((s: { id: string }) => s.id)).not.toContain(spot.id)
  })
})

describe('POST /user-photos/:photoId/report', () => {
  it('cria denúncia de foto do mural com targetType USER_PHOTO', async () => {
    const owner = await makeUser()
    const reporter = await makeUser()
    const photo = await makeUserPhoto(owner.id)

    const res = await app.inject({
      method: 'POST',
      url: `/user-photos/${photo.id}/report`,
      headers: { authorization: `Bearer ${token(app, reporter.id)}` },
      body: { reason: 'INAPPROPRIATE_CONTENT', details: 'Nudez' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({
      userPhotoId: photo.id,
      reporterId: reporter.id,
      reason: 'INAPPROPRIATE_CONTENT',
      status: 'PENDING',
    })
    // O dono NÃO é o alvo: o alvo é a foto.
    expect(res.json().targetUserId).toBeNull()
  })

  it('aceita o alias plural /user-photos/:photoId/reports', async () => {
    const owner = await makeUser()
    const reporter = await makeUser()
    const photo = await makeUserPhoto(owner.id)

    const res = await app.inject({
      method: 'POST',
      url: `/user-photos/${photo.id}/reports`,
      headers: { authorization: `Bearer ${token(app, reporter.id)}` },
      body: { reason: 'SPAM_OR_FRAUD' },
    })

    expect(res.statusCode).toBe(201)
  })

  it('retorna 400 ao denunciar a própria foto', async () => {
    const owner = await makeUser()
    const photo = await makeUserPhoto(owner.id)

    const res = await app.inject({
      method: 'POST',
      url: `/user-photos/${photo.id}/report`,
      headers: { authorization: `Bearer ${token(app, owner.id)}` },
      body: { reason: 'OTHER' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('SELF_REPORT')
  })

  it('retorna 409 na segunda denúncia aberta da mesma foto', async () => {
    const owner = await makeUser()
    const reporter = await makeUser()
    const photo = await makeUserPhoto(owner.id)
    const headers = { authorization: `Bearer ${token(app, reporter.id)}` }

    await app.inject({
      method: 'POST',
      url: `/user-photos/${photo.id}/report`,
      headers,
      body: { reason: 'HARASSMENT' },
    })
    const res = await app.inject({
      method: 'POST',
      url: `/user-photos/${photo.id}/report`,
      headers,
      body: { reason: 'HARASSMENT' },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('REPORT_ALREADY_OPEN')
  })

  it('retorna 404 para foto inexistente', async () => {
    const reporter = await makeUser()

    const res = await app.inject({
      method: 'POST',
      url: '/user-photos/00000000-0000-4000-8000-000000000000/report',
      headers: { authorization: `Bearer ${token(app, reporter.id)}` },
      body: { reason: 'OTHER' },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('USER_PHOTO_NOT_FOUND')
  })

  // Mesmo portão do GET /users/:id/photos: quem não vê o mural não denuncia o
  // que há nele — privacidade e bloqueio ficam atrás de 404, sem confirmar que
  // a foto existe.
  it('retorna 404 quando o mural não é visível ao denunciante (privado sem follow, bloqueio)', async () => {
    const privateOwner = await makeUser({ isPrivate: true })
    const stranger = await makeUser()
    const privatePhoto = await makeUserPhoto(privateOwner.id)

    const blockingOwner = await makeUser()
    const blocked = await makeUser()
    await makeBlock(blockingOwner.id, blocked.id)
    const blockedPhoto = await makeUserPhoto(blockingOwner.id)

    for (const { photoId, reporterId } of [
      { photoId: privatePhoto.id, reporterId: stranger.id },
      { photoId: blockedPhoto.id, reporterId: blocked.id },
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: `/user-photos/${photoId}/report`,
        headers: { authorization: `Bearer ${token(app, reporterId)}` },
        body: { reason: 'OTHER' },
      })
      expect(res.statusCode).toBe(404)
      expect(res.json().code).toBe('USER_PHOTO_NOT_FOUND')
    }
  })

  it('seguidor aceito denuncia foto de perfil privado', async () => {
    const owner = await makeUser({ isPrivate: true })
    const follower = await makeUser()
    await makeFollow(follower.id, owner.id, 'ACCEPTED')
    const photo = await makeUserPhoto(owner.id)

    const res = await app.inject({
      method: 'POST',
      url: `/user-photos/${photo.id}/report`,
      headers: { authorization: `Bearer ${token(app, follower.id)}` },
      body: { reason: 'OTHER' },
    })

    expect(res.statusCode).toBe(201)
  })

  it('retorna 401 sem autenticação', async () => {
    const owner = await makeUser()
    const photo = await makeUserPhoto(owner.id)

    const res = await app.inject({
      method: 'POST',
      url: `/user-photos/${photo.id}/report`,
      body: { reason: 'OTHER' },
    })

    expect(res.statusCode).toBe(401)
  })
})

describe('moderação de denúncia de foto do mural', () => {
  it('filtra por targetType=USER_PHOTO em GET /reports e traz o resumo da foto', async () => {
    const admin = await makeUser({ role: 'ADMIN' })
    const owner = await makeUser()
    const reporter = await makeUser()
    const photo = await makeUserPhoto(owner.id, {
      imagesCount: 2,
      caption: 'legenda',
    })
    const event = await makeEvent(owner.id)
    await app.inject({
      method: 'POST',
      url: `/user-photos/${photo.id}/report`,
      headers: { authorization: `Bearer ${token(app, reporter.id)}` },
      body: { reason: 'OTHER' },
    })
    await app.inject({
      method: 'POST',
      url: `/events/${event.id}/report`,
      headers: { authorization: `Bearer ${token(app, reporter.id)}` },
      body: { reason: 'OTHER' },
    })

    const res = await app.inject({
      method: 'GET',
      url: '/reports?targetType=USER_PHOTO',
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
    const [report] = res.json().data
    expect(report.userPhotoId).toBe(photo.id)
    // O painel precisa ver a foto e de quem é sem uma busca a mais.
    expect(report.userPhoto).toMatchObject({
      id: photo.id,
      caption: 'legenda',
      user: { id: owner.id, username: owner.username },
    })
    expect(report.userPhoto.images).toHaveLength(2)
    expect(report.userPhoto.images[0].url).toBe(photo.images[0].url)
  })

  it('DELETE /reports/:id/target apaga a foto e os blobs', async () => {
    const admin = await makeUser({ role: 'ADMIN' })
    const owner = await makeUser()
    const reporter = await makeUser()
    const photo = await makeUserPhoto(owner.id, { imagesCount: 2 })
    const created = await app.inject({
      method: 'POST',
      url: `/user-photos/${photo.id}/report`,
      headers: { authorization: `Bearer ${token(app, reporter.id)}` },
      body: { reason: 'INAPPROPRIATE_CONTENT' },
    })

    const res = await app.inject({
      method: 'DELETE',
      url: `/reports/${created.json().id}/target`,
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('RESOLVED_REMOVED')
    // SetNull: a denúncia fica, apontando para lugar nenhum.
    expect(res.json().userPhotoId).toBeNull()
    expect(await testPrisma.userPhoto.count({ where: { id: photo.id } })).toBe(
      0,
    )
    for (const image of photo.images) {
      expect(fakeStorage.deleted).toContain(image.key)
    }
  })

  it('foto apagada pelo dono antes da moderação deixa a denúncia sem alvo', async () => {
    const admin = await makeUser({ role: 'ADMIN' })
    const owner = await makeUser()
    const reporter = await makeUser()
    const photo = await makeUserPhoto(owner.id)
    const created = await app.inject({
      method: 'POST',
      url: `/user-photos/${photo.id}/report`,
      headers: { authorization: `Bearer ${token(app, reporter.id)}` },
      body: { reason: 'OTHER' },
    })

    const removed = await app.inject({
      method: 'DELETE',
      url: `/users/me/photos/${photo.id}`,
      headers: { authorization: `Bearer ${token(app, owner.id)}` },
    })
    expect(removed.statusCode).toBe(204)

    const detail = await app.inject({
      method: 'GET',
      url: `/reports/${created.json().id}`,
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
    })
    expect(detail.statusCode).toBe(200)
    expect(detail.json().userPhotoId).toBeNull()

    const res = await app.inject({
      method: 'DELETE',
      url: `/reports/${created.json().id}/target`,
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('REPORTED_CONTENT_GONE')
  })
})
