import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import {
  makeDirectConversation,
  makeGroupConversation,
  makeMessage,
  makeUser,
} from '../../test/factories'
import { fakeStorage } from '../../test/fake-storage'
import { testPrisma } from '../../test/prisma'
import { reconcileReportEvidenceRetention } from './report-evidence.reconciler'

let app: FastifyInstance

function token(app: FastifyInstance, userId: string) {
  return app.jwt.sign({ sub: userId })
}

async function attach(
  messageId: string,
  overrides: { key?: string; thumbnailKey?: string | null } = {},
) {
  return testPrisma.messageAttachment.create({
    data: {
      messageId,
      kind: 'VIDEO',
      url: 'https://cdn.test/v.mp4',
      key: overrides.key ?? 'conversations/c/v.mp4',
      thumbnailKey:
        overrides.thumbnailKey === undefined
          ? 'conversations/c/poster.webp'
          : overrides.thumbnailKey,
      format: 'mp4',
      size: 2048,
      order: 0,
    },
  })
}

/** Denúncia de mensagem por quem participa da conversa. */
async function report(reporterId: string, messageId: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/messages/${messageId}/report`,
    headers: { authorization: `Bearer ${token(app, reporterId)}` },
    body: { reason: 'HARASSMENT' },
  })
  expect(res.statusCode).toBe(201)
  return res.json()
}

beforeAll(async () => {
  app = buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await testPrisma.$disconnect()
})

describe('captura do snapshot', () => {
  it('grava denúncia e evidência juntas', async () => {
    const autor = await makeUser()
    const denunciante = await makeUser()
    const convo = await makeDirectConversation(autor.id, denunciante.id)
    const message = await makeMessage(convo.id, autor.id, {
      content: 'te acho um lixo',
    })

    const created = await report(denunciante.id, message.id)

    const evidence = await testPrisma.reportEvidence.findUniqueOrThrow({
      where: { reportId: created.id },
    })
    expect(evidence.reportedMessageId).toBe(message.id)
    expect(evidence.reportedUserId).toBe(autor.id)
    expect(evidence.conversationId).toBe(convo.id)
    // O payload é opaco no banco: nem o texto denunciado aparece nele.
    expect(Buffer.from(evidence.payloadCipher).toString('utf8')).not.toContain(
      'te acho um lixo',
    )
  })

  it('captura o contexto ao redor, e só o da própria conversa', async () => {
    const autor = await makeUser()
    const denunciante = await makeUser()
    const convo = await makeDirectConversation(autor.id, denunciante.id)
    const outra = await makeGroupConversation(autor.id, [denunciante.id])

    const base = Date.now()
    for (let i = 0; i < 3; i++) {
      await makeMessage(convo.id, denunciante.id, {
        content: `antes ${i}`,
        createdAt: new Date(base + i * 1000),
      })
    }
    const alvo = await makeMessage(convo.id, autor.id, {
      content: 'a ofensa',
      createdAt: new Date(base + 10_000),
    })
    await makeMessage(convo.id, denunciante.id, {
      content: 'depois 0',
      createdAt: new Date(base + 11_000),
    })
    await makeMessage(outra.id, autor.id, {
      content: 'de outra conversa',
      createdAt: new Date(base + 5_000),
    })

    const created = await report(denunciante.id, alvo.id)
    const admin = await makeUser({ role: 'ADMIN' })
    const res = await app.inject({
      method: 'GET',
      url: `/reports/${created.id}/evidence`,
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
    })

    expect(res.statusCode).toBe(200)
    const textos = res
      .json()
      .messages.map((m: { content: string }) => m.content)
    expect(textos).toEqual([
      'antes 0',
      'antes 1',
      'antes 2',
      'a ofensa',
      'depois 0',
    ])
    expect(textos).not.toContain('de outra conversa')
    expect(
      res.json().messages.find((m: { isReported: boolean }) => m.isReported)
        .content,
    ).toBe('a ofensa')
  })
})

describe('GET /reports/:id/evidence', () => {
  it('devolve o conteúdo decifrado para o admin', async () => {
    const autor = await makeUser()
    const denunciante = await makeUser()
    const admin = await makeUser({ role: 'ADMIN' })
    const convo = await makeDirectConversation(autor.id, denunciante.id)
    const message = await makeMessage(convo.id, autor.id, {
      content: 'ameaça explícita',
    })
    const created = await report(denunciante.id, message.id)

    const res = await app.inject({
      method: 'GET',
      url: `/reports/${created.id}/evidence`,
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().reportedMessageId).toBe(message.id)
    expect(res.json().messages[0].content).toBe('ameaça explícita')
  })

  it('retorna 403 para usuário comum, inclusive o denunciante', async () => {
    const autor = await makeUser()
    const denunciante = await makeUser()
    const convo = await makeDirectConversation(autor.id, denunciante.id)
    const message = await makeMessage(convo.id, autor.id)
    const created = await report(denunciante.id, message.id)

    const res = await app.inject({
      method: 'GET',
      url: `/reports/${created.id}/evidence`,
      headers: { authorization: `Bearer ${token(app, denunciante.id)}` },
    })

    expect(res.statusCode).toBe(403)
  })

  it('retorna 401 sem token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/reports/00000000-0000-0000-0000-000000000000/evidence',
    })
    expect(res.statusCode).toBe(401)
  })

  it('retorna 404 explicativo para denúncia sem evidência', async () => {
    const autor = await makeUser()
    const denunciante = await makeUser()
    const admin = await makeUser({ role: 'ADMIN' })
    const convo = await makeDirectConversation(autor.id, denunciante.id)
    const message = await makeMessage(convo.id, autor.id)
    const created = await report(denunciante.id, message.id)
    // Simula denúncia anterior ao recurso.
    await testPrisma.reportEvidence.deleteMany({
      where: { reportId: created.id },
    })

    const res = await app.inject({
      method: 'GET',
      url: `/reports/${created.id}/evidence`,
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('REPORT_EVIDENCE_NOT_FOUND')
  })

  it('grava uma linha de auditoria por leitura', async () => {
    const autor = await makeUser()
    const denunciante = await makeUser()
    const admin = await makeUser({ role: 'ADMIN' })
    const convo = await makeDirectConversation(autor.id, denunciante.id)
    const message = await makeMessage(convo.id, autor.id)
    const created = await report(denunciante.id, message.id)

    const ler = () =>
      app.inject({
        method: 'GET',
        url: `/reports/${created.id}/evidence`,
        headers: { authorization: `Bearer ${token(app, admin.id)}` },
      })
    await ler()
    await ler()

    const logs = await testPrisma.moderationAccessLog.findMany({
      where: { reportId: created.id },
    })
    expect(logs).toHaveLength(2)
    expect(logs[0]).toMatchObject({
      adminId: admin.id,
      action: 'VIEW_EVIDENCE',
    })
  })

  it('não grava auditoria quando o requisitante não é admin', async () => {
    const autor = await makeUser()
    const denunciante = await makeUser()
    const convo = await makeDirectConversation(autor.id, denunciante.id)
    const message = await makeMessage(convo.id, autor.id)
    const created = await report(denunciante.id, message.id)

    await app.inject({
      method: 'GET',
      url: `/reports/${created.id}/evidence`,
      headers: { authorization: `Bearer ${token(app, denunciante.id)}` },
    })

    const logs = await testPrisma.moderationAccessLog.findMany()
    expect(logs).toHaveLength(0)
  })
})

describe('a prova sobrevive à remoção do conteúdo', () => {
  it('mantém a evidência legível e retém a mídia após DELETE /reports/:id/target', async () => {
    fakeStorage.reset()
    const autor = await makeUser()
    const denunciante = await makeUser()
    const admin = await makeUser({ role: 'ADMIN' })
    const convo = await makeDirectConversation(autor.id, denunciante.id)
    const message = await makeMessage(convo.id, autor.id, {
      content: 'olha esse vídeo',
    })
    await attach(message.id)
    const created = await report(denunciante.id, message.id)

    const del = await app.inject({
      method: 'DELETE',
      url: `/reports/${created.id}/target`,
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
    })
    expect(del.statusCode).toBe(200)

    // Vídeo E poster preservados: apagar o poster destruiria metade da prova.
    expect(fakeStorage.deleted).not.toContain('conversations/c/v.mp4')
    expect(fakeStorage.deleted).not.toContain('conversations/c/poster.webp')

    const res = await app.inject({
      method: 'GET',
      url: `/reports/${created.id}/evidence`,
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().messages[0].content).toBe('olha esse vídeo')
    expect(res.json().messages[0].attachments[0].url).toContain('v.mp4')
  })

  it('apaga a mídia não retida da mesma mensagem', async () => {
    fakeStorage.reset()
    const autor = await makeUser()
    const denunciante = await makeUser()
    const admin = await makeUser({ role: 'ADMIN' })
    const convo = await makeDirectConversation(autor.id, denunciante.id)
    const message = await makeMessage(convo.id, autor.id)
    await attach(message.id, { key: 'conversations/c/retido.mp4' })
    const created = await report(denunciante.id, message.id)
    // Anexo que entrou DEPOIS da captura: não é prova, então deve ser apagado.
    await attach(message.id, {
      key: 'conversations/c/posterior.mp4',
      thumbnailKey: null,
    })

    await app.inject({
      method: 'DELETE',
      url: `/reports/${created.id}/target`,
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
    })

    expect(fakeStorage.deleted).toContain('conversations/c/posterior.mp4')
    expect(fakeStorage.deleted).not.toContain('conversations/c/retido.mp4')
  })

  it('sobrevive à deleção da conversa inteira', async () => {
    const autor = await makeUser()
    const denunciante = await makeUser()
    const admin = await makeUser({ role: 'ADMIN' })
    const convo = await makeGroupConversation(autor.id, [denunciante.id])
    const message = await makeMessage(convo.id, autor.id, {
      content: 'some daqui',
    })
    const created = await report(denunciante.id, message.id)

    await testPrisma.conversation.delete({ where: { id: convo.id } })

    const res = await app.inject({
      method: 'GET',
      url: `/reports/${created.id}/evidence`,
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().messages[0].content).toBe('some daqui')
  })

  it('limpa a mídia retida quando a denúncia é apagada', async () => {
    fakeStorage.reset()
    const autor = await makeUser()
    const denunciante = await makeUser()
    const admin = await makeUser({ role: 'ADMIN' })
    const convo = await makeDirectConversation(autor.id, denunciante.id)
    const message = await makeMessage(convo.id, autor.id)
    await attach(message.id)
    const created = await report(denunciante.id, message.id)

    await app.inject({
      method: 'DELETE',
      url: `/reports/${created.id}`,
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
    })

    expect(fakeStorage.deleted).toContain('conversations/c/v.mp4')
    expect(fakeStorage.deleted).toContain('conversations/c/poster.webp')
  })
})

describe('GET /reports', () => {
  it('não devolve mais o conteúdo da mensagem, só se há prova', async () => {
    const autor = await makeUser()
    const denunciante = await makeUser()
    const admin = await makeUser({ role: 'ADMIN' })
    const convo = await makeDirectConversation(autor.id, denunciante.id)
    const message = await makeMessage(convo.id, autor.id, {
      content: 'conteúdo sensível',
    })
    await report(denunciante.id, message.id)

    const res = await app.inject({
      method: 'GET',
      url: '/reports',
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.payload).not.toContain('conteúdo sensível')
    const [report0] = res.json().data
    expect(report0.message.content).toBeUndefined()
    expect(report0.hasEvidence).toBe(true)
    expect(report0.evidence).toBeUndefined()
  })
})

describe('retenção', () => {
  it('purga a evidência vencida e a mídia retida', async () => {
    fakeStorage.reset()
    const autor = await makeUser()
    const denunciante = await makeUser()
    const admin = await makeUser({ role: 'ADMIN' })
    const convo = await makeDirectConversation(autor.id, denunciante.id)
    const message = await makeMessage(convo.id, autor.id)
    await attach(message.id)
    const created = await report(denunciante.id, message.id)

    await testPrisma.reportEvidence.update({
      where: { reportId: created.id },
      data: { capturedAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000) },
    })

    const first = await reconcileReportEvidenceRetention()
    expect(first).toEqual({ due: 1, purged: 1 })
    expect(fakeStorage.deleted).toContain('conversations/c/v.mp4')

    const row = await testPrisma.reportEvidence.findUniqueOrThrow({
      where: { reportId: created.id },
    })
    expect(row.purgedAt).not.toBeNull()
    expect(row.payloadCipher).toHaveLength(0)
    expect(row.retainedMediaKeys).toEqual([])

    // Idempotente: a linha purgada sai do predicado.
    expect(await reconcileReportEvidenceRetention()).toEqual({
      due: 0,
      purged: 0,
    })

    const res = await app.inject({
      method: 'GET',
      url: `/reports/${created.id}/evidence`,
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
    })
    expect(res.statusCode).toBe(404)
  })

  it('não toca em evidência dentro do prazo', async () => {
    const autor = await makeUser()
    const denunciante = await makeUser()
    const convo = await makeDirectConversation(autor.id, denunciante.id)
    const message = await makeMessage(convo.id, autor.id)
    await report(denunciante.id, message.id)

    expect(await reconcileReportEvidenceRetention()).toEqual({
      due: 0,
      purged: 0,
    })
  })
})
