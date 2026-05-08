import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import {
  makeComment,
  makeEvent,
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
