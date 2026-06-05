import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import {
  makeBlock,
  makeDirectConversation,
  makeFollow,
  makeGroupConversation,
  makeMessage,
  makeUser,
} from '../../test/factories'
import {
  multipartFormData,
  tinyM4aBuffer,
  tinyPngBuffer,
} from '../../test/image-fixture'
import { testPrisma } from '../../test/prisma'
import { findConversationPartnerIds } from './chat.repository'

let app: FastifyInstance

function token(userId: string) {
  return app.jwt.sign({ sub: userId })
}

function auth(userId: string) {
  return { authorization: `Bearer ${token(userId)}` }
}

beforeAll(async () => {
  app = buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await testPrisma.$disconnect()
})

describe('POST /conversations — DIRECT', () => {
  it('cria conversa direta (201)', async () => {
    const viewer = await makeUser()
    const target = await makeUser()

    const res = await app.inject({
      method: 'POST',
      url: '/conversations',
      headers: auth(viewer.id),
      body: { type: 'DIRECT', targetUserId: target.id },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().type).toBe('DIRECT')
    expect(res.json().participants).toHaveLength(2)
  })

  it('é idempotente: recriar a mesma DM retorna 200 e mesma conversa', async () => {
    const a = await makeUser()
    const b = await makeUser()

    const first = await app.inject({
      method: 'POST',
      url: '/conversations',
      headers: auth(a.id),
      body: { type: 'DIRECT', targetUserId: b.id },
    })
    expect(first.statusCode).toBe(201)

    // ordem inversa (b inicia com a) → mesma conversa
    const second = await app.inject({
      method: 'POST',
      url: '/conversations',
      headers: auth(b.id),
      body: { type: 'DIRECT', targetUserId: a.id },
    })
    expect(second.statusCode).toBe(200)
    expect(second.json().id).toBe(first.json().id)
  })

  it('400 ao tentar conversar consigo mesmo', async () => {
    const viewer = await makeUser()
    const res = await app.inject({
      method: 'POST',
      url: '/conversations',
      headers: auth(viewer.id),
      body: { type: 'DIRECT', targetUserId: viewer.id },
    })
    expect(res.statusCode).toBe(400)
  })

  it('403 ao iniciar DM com perfil privado sem follow', async () => {
    const viewer = await makeUser()
    const target = await makeUser({ isPrivate: true })

    const res = await app.inject({
      method: 'POST',
      url: '/conversations',
      headers: auth(viewer.id),
      body: { type: 'DIRECT', targetUserId: target.id },
    })
    expect(res.statusCode).toBe(403)
  })

  it('permite DM com perfil privado que o viewer segue (ACCEPTED)', async () => {
    const viewer = await makeUser()
    const target = await makeUser({ isPrivate: true })
    await makeFollow(viewer.id, target.id, 'ACCEPTED')

    const res = await app.inject({
      method: 'POST',
      url: '/conversations',
      headers: auth(viewer.id),
      body: { type: 'DIRECT', targetUserId: target.id },
    })
    expect(res.statusCode).toBe(201)
  })

  it('403 ao iniciar DM com bloqueio em qualquer direção', async () => {
    const viewer = await makeUser()
    const target = await makeUser()
    await makeBlock(target.id, viewer.id)

    const res = await app.inject({
      method: 'POST',
      url: '/conversations',
      headers: auth(viewer.id),
      body: { type: 'DIRECT', targetUserId: target.id },
    })
    expect(res.statusCode).toBe(403)
  })

  it('401 sem autenticação', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/conversations',
      body: { type: 'DIRECT', targetUserId: crypto.randomUUID() },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('mensagens', () => {
  it('envia mensagem e atualiza lastMessageAt e histórico', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)

    const sent = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages`,
      headers: auth(a.id),
      body: { content: 'Olá!' },
    })
    expect(sent.statusCode).toBe(201)
    expect(sent.json().content).toBe('Olá!')

    const history = await app.inject({
      method: 'GET',
      url: `/conversations/${convo.id}/messages`,
      headers: auth(b.id),
    })
    expect(history.statusCode).toBe(200)
    expect(
      history.json().data.some((m: { id: string }) => m.id === sent.json().id),
    ).toBe(true)

    const detail = await testPrisma.conversation.findUnique({
      where: { id: convo.id },
      select: { lastMessageAt: true },
    })
    expect(detail?.lastMessageAt).not.toBeNull()
  })

  it('não-participante recebe 403 ao listar/enviar', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const stranger = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)

    const list = await app.inject({
      method: 'GET',
      url: `/conversations/${convo.id}/messages`,
      headers: auth(stranger.id),
    })
    expect(list.statusCode).toBe(403)

    const send = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages`,
      headers: auth(stranger.id),
      body: { content: 'invasão' },
    })
    expect(send.statusCode).toBe(403)
  })

  it('404 ao listar conversa inexistente', async () => {
    const viewer = await makeUser()
    const res = await app.inject({
      method: 'GET',
      url: `/conversations/${crypto.randomUUID()}/messages`,
      headers: auth(viewer.id),
    })
    expect(res.statusCode).toBe(404)
  })

  it('paginação de histórico por cursor sem repetição', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    for (let i = 0; i < 5; i++) {
      await makeMessage(convo.id, a.id, {
        content: `m${i}`,
        createdAt: new Date(Date.now() + i * 1000),
      })
    }

    const page1 = await app.inject({
      method: 'GET',
      url: `/conversations/${convo.id}/messages?limit=2`,
      headers: auth(a.id),
    })
    const body1 = page1.json()
    expect(body1.data).toHaveLength(2)
    expect(body1.nextCursor).toBeTruthy()

    const page2 = await app.inject({
      method: 'GET',
      url: `/conversations/${convo.id}/messages?limit=2&cursor=${body1.nextCursor}`,
      headers: auth(a.id),
    })
    const ids1 = body1.data.map((m: { id: string }) => m.id)
    const ids2 = page2.json().data.map((m: { id: string }) => m.id)
    expect(ids1.some((id: string) => ids2.includes(id))).toBe(false)
  })

  it('soft delete vira tombstone; apagar mensagem de outro → 403', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    const msg = await makeMessage(convo.id, a.id, { content: 'apagar' })

    const forbidden = await app.inject({
      method: 'DELETE',
      url: `/conversations/${convo.id}/messages/${msg.id}`,
      headers: auth(b.id),
    })
    expect(forbidden.statusCode).toBe(403)

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/conversations/${convo.id}/messages/${msg.id}`,
      headers: auth(a.id),
    })
    expect(deleted.statusCode).toBe(204)

    const history = await app.inject({
      method: 'GET',
      url: `/conversations/${convo.id}/messages`,
      headers: auth(a.id),
    })
    const found = history
      .json()
      .data.find((m: { id: string }) => m.id === msg.id)
    expect(found.content).toBeNull()
    expect(found.deletedAt).not.toBeNull()
  })
})

describe('unread count e read receipts', () => {
  it('conta não-lidas e zera após marcar como lida', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)

    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: 'POST',
        url: `/conversations/${convo.id}/messages`,
        headers: auth(a.id),
        body: { content: `m${i}` },
      })
    }

    const inboxB = await app.inject({
      method: 'GET',
      url: '/conversations',
      headers: auth(b.id),
    })
    const itemB = inboxB
      .json()
      .data.find((c: { id: string }) => c.id === convo.id)
    expect(itemB.unreadCount).toBe(3)

    // remetente não tem não-lidas das próprias mensagens
    const inboxA = await app.inject({
      method: 'GET',
      url: '/conversations',
      headers: auth(a.id),
    })
    const itemA = inboxA
      .json()
      .data.find((c: { id: string }) => c.id === convo.id)
    expect(itemA.unreadCount).toBe(0)

    const read = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/read`,
      headers: auth(b.id),
    })
    expect(read.statusCode).toBe(204)

    const inboxB2 = await app.inject({
      method: 'GET',
      url: '/conversations',
      headers: auth(b.id),
    })
    const itemB2 = inboxB2
      .json()
      .data.find((c: { id: string }) => c.id === convo.id)
    expect(itemB2.unreadCount).toBe(0)
  })
})

describe('grupos', () => {
  it('cria grupo com criador ADMIN', async () => {
    const owner = await makeUser()
    const m1 = await makeUser()
    const m2 = await makeUser()

    const res = await app.inject({
      method: 'POST',
      url: '/conversations',
      headers: auth(owner.id),
      body: { type: 'GROUP', title: 'Squad', participantIds: [m1.id, m2.id] },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().type).toBe('GROUP')
    const ownerParticipant = res
      .json()
      .participants.find((p: { userId: string }) => p.userId === owner.id)
    expect(ownerParticipant.role).toBe('ADMIN')
  })

  it('não-membro recebe 403 ao ver/enviar no grupo', async () => {
    const owner = await makeUser()
    const stranger = await makeUser()
    const group = await makeGroupConversation(owner.id, [])

    const res = await app.inject({
      method: 'GET',
      url: `/conversations/${group.id}`,
      headers: auth(stranger.id),
    })
    expect(res.statusCode).toBe(403)
  })

  it('rename: 403 não-admin, 200 admin', async () => {
    const owner = await makeUser()
    const member = await makeUser()
    const group = await makeGroupConversation(owner.id, [member.id])

    const byMember = await app.inject({
      method: 'PATCH',
      url: `/conversations/${group.id}`,
      headers: auth(member.id),
      body: { title: 'Novo nome' },
    })
    expect(byMember.statusCode).toBe(403)

    const byAdmin = await app.inject({
      method: 'PATCH',
      url: `/conversations/${group.id}`,
      headers: auth(owner.id),
      body: { title: 'Novo nome' },
    })
    expect(byAdmin.statusCode).toBe(200)
    expect(byAdmin.json().title).toBe('Novo nome')
  })

  it('admin adiciona participante; 409 se já é membro', async () => {
    const owner = await makeUser()
    const newcomer = await makeUser()
    const group = await makeGroupConversation(owner.id, [])

    const added = await app.inject({
      method: 'POST',
      url: `/conversations/${group.id}/participants`,
      headers: auth(owner.id),
      body: { userId: newcomer.id },
    })
    expect(added.statusCode).toBe(201)

    const again = await app.inject({
      method: 'POST',
      url: `/conversations/${group.id}/participants`,
      headers: auth(owner.id),
      body: { userId: newcomer.id },
    })
    expect(again.statusCode).toBe(409)
  })

  it('403 ao adicionar alvo não-visível (privado sem follow)', async () => {
    const owner = await makeUser()
    const privateUser = await makeUser({ isPrivate: true })
    const group = await makeGroupConversation(owner.id, [])

    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${group.id}/participants`,
      headers: auth(owner.id),
      body: { userId: privateUser.id },
    })
    expect(res.statusCode).toBe(403)
  })

  it('leave: participante sai e deixa de ver o grupo', async () => {
    const owner = await makeUser()
    const member = await makeUser()
    const group = await makeGroupConversation(owner.id, [member.id])

    const left = await app.inject({
      method: 'POST',
      url: `/conversations/${group.id}/leave`,
      headers: auth(member.id),
    })
    expect(left.statusCode).toBe(204)

    const inbox = await app.inject({
      method: 'GET',
      url: '/conversations',
      headers: auth(member.id),
    })
    expect(
      inbox.json().data.some((c: { id: string }) => c.id === group.id),
    ).toBe(false)
  })
})

describe('bloqueio em DM', () => {
  it('após bloquear, envio é barrado (403) mas histórico continua legível', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    await makeMessage(convo.id, a.id, { content: 'antes do block' })
    await makeBlock(a.id, b.id)

    const send = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages`,
      headers: auth(a.id),
      body: { content: 'depois do block' },
    })
    expect(send.statusCode).toBe(403)

    const history = await app.inject({
      method: 'GET',
      url: `/conversations/${convo.id}/messages`,
      headers: auth(a.id),
    })
    expect(history.statusCode).toBe(200)
    expect(history.json().data.length).toBeGreaterThanOrEqual(1)
  })
})

describe('anexo de imagem', () => {
  it('envia imagem (multipart) criando anexo', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    const png = await tinyPngBuffer()
    const { body, contentType } = multipartFormData(
      png,
      'image',
      'foto.png',
      'image/png',
    )

    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages/images`,
      headers: { ...auth(a.id), 'content-type': contentType },
      payload: body,
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().attachments).toHaveLength(1)
    expect(res.json().attachments[0].url).toMatch(/^https:\/\/fake\.storage\//)
  })

  it('mimetype inválido → 400', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    const { body, contentType } = multipartFormData(
      Buffer.from('not an image'),
      'image',
      'a.txt',
      'text/plain',
    )

    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages/images`,
      headers: { ...auth(a.id), 'content-type': contentType },
      payload: body,
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('anexo de áudio', () => {
  it('envia áudio (multipart) criando anexo com duração e waveform', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    const { body, contentType } = multipartFormData(
      tinyM4aBuffer(),
      'audio',
      'nota.m4a',
      'audio/mp4',
      { durationMs: '3200', waveform: '[3, 7, 12, 9, 4]' },
    )

    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages/audio`,
      headers: { ...auth(a.id), 'content-type': contentType },
      payload: body,
    })

    expect(res.statusCode).toBe(201)
    const attachment = res.json().attachments[0]
    expect(res.json().attachments).toHaveLength(1)
    expect(attachment.kind).toBe('AUDIO')
    expect(attachment.durationMs).toBe(3200)
    expect(attachment.waveform).toEqual([3, 7, 12, 9, 4])
    expect(attachment.url).toMatch(/^https:\/\/fake\.storage\//)
  })

  it('áudio sem waveform usa lista vazia', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    const { body, contentType } = multipartFormData(
      tinyM4aBuffer(),
      'audio',
      'nota.m4a',
      'audio/mp4',
      { durationMs: '1500' },
    )

    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages/audio`,
      headers: { ...auth(a.id), 'content-type': contentType },
      payload: body,
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().attachments[0].waveform).toEqual([])
  })

  it('mimetype não-áudio → 400', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    const { body, contentType } = multipartFormData(
      Buffer.from('not audio'),
      'audio',
      'a.txt',
      'text/plain',
      { durationMs: '1000' },
    )

    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages/audio`,
      headers: { ...auth(a.id), 'content-type': contentType },
      payload: body,
    })
    expect(res.statusCode).toBe(400)
  })

  it('waveform com JSON inválido → 400', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    const { body, contentType } = multipartFormData(
      tinyM4aBuffer(),
      'audio',
      'nota.m4a',
      'audio/mp4',
      { durationMs: '1000', waveform: 'not-json' },
    )

    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages/audio`,
      headers: { ...auth(a.id), 'content-type': contentType },
      payload: body,
    })
    expect(res.statusCode).toBe(400)
  })

  it('durationMs fora do range → 400', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    const { body, contentType } = multipartFormData(
      tinyM4aBuffer(),
      'audio',
      'nota.m4a',
      'audio/mp4',
      { durationMs: '700000' },
    )

    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages/audio`,
      headers: { ...auth(a.id), 'content-type': contentType },
      payload: body,
    })
    expect(res.statusCode).toBe(400)
  })

  it('áudio sem durationMs → 400', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    const { body, contentType } = multipartFormData(
      tinyM4aBuffer(),
      'audio',
      'nota.m4a',
      'audio/mp4',
    )

    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages/audio`,
      headers: { ...auth(a.id), 'content-type': contentType },
      payload: body,
    })
    expect(res.statusCode).toBe(400)
  })

  it('não-participante → 403', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const outsider = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    const { body, contentType } = multipartFormData(
      tinyM4aBuffer(),
      'audio',
      'nota.m4a',
      'audio/mp4',
      { durationMs: '1000' },
    )

    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages/audio`,
      headers: { ...auth(outsider.id), 'content-type': contentType },
      payload: body,
    })
    expect(res.statusCode).toBe(403)
  })

  it('sem autenticação → 401', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    const { body, contentType } = multipartFormData(
      tinyM4aBuffer(),
      'audio',
      'nota.m4a',
      'audio/mp4',
      { durationMs: '1000' },
    )

    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages/audio`,
      headers: { 'content-type': contentType },
      payload: body,
    })
    expect(res.statusCode).toBe(401)
  })

  it('mensagem só de áudio não pode ser editada → 403', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    const { body, contentType } = multipartFormData(
      tinyM4aBuffer(),
      'audio',
      'nota.m4a',
      'audio/mp4',
      { durationMs: '1000' },
    )

    const created = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages/audio`,
      headers: { ...auth(a.id), 'content-type': contentType },
      payload: body,
    })
    const messageId = created.json().id

    const res = await app.inject({
      method: 'PATCH',
      url: `/conversations/${convo.id}/messages/${messageId}`,
      headers: auth(a.id),
      body: { content: 'tentando editar' },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('inbox — DM vazia e ocultar (mudanças 1 e 2)', () => {
  it('esconde DM sem nenhuma mensagem', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)

    const inbox = await app.inject({
      method: 'GET',
      url: '/conversations',
      headers: auth(a.id),
    })
    expect(
      inbox.json().data.some((c: { id: string }) => c.id === convo.id),
    ).toBe(false)
  })

  it('DM aparece após a primeira mensagem (com lastMessage)', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages`,
      headers: auth(a.id),
      body: { content: 'oi' },
    })

    const inbox = await app.inject({
      method: 'GET',
      url: '/conversations',
      headers: auth(b.id),
    })
    const item = inbox
      .json()
      .data.find((c: { id: string }) => c.id === convo.id)
    expect(item).toBeDefined()
    expect(item.lastMessage).not.toBeNull()
  })

  it('grupo aparece no inbox mesmo sem mensagens', async () => {
    const owner = await makeUser()
    const group = await makeGroupConversation(owner.id, [])

    const inbox = await app.inject({
      method: 'GET',
      url: '/conversations',
      headers: auth(owner.id),
    })
    expect(
      inbox.json().data.some((c: { id: string }) => c.id === group.id),
    ).toBe(true)
  })

  it('DELETE oculta pra mim (204) mas mantém pro outro', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    await makeMessage(convo.id, a.id, { content: 'oi' })

    const del = await app.inject({
      method: 'DELETE',
      url: `/conversations/${convo.id}`,
      headers: auth(a.id),
    })
    expect(del.statusCode).toBe(204)

    const inboxA = await app.inject({
      method: 'GET',
      url: '/conversations',
      headers: auth(a.id),
    })
    expect(
      inboxA.json().data.some((c: { id: string }) => c.id === convo.id),
    ).toBe(false)

    const inboxB = await app.inject({
      method: 'GET',
      url: '/conversations',
      headers: auth(b.id),
    })
    expect(
      inboxB.json().data.some((c: { id: string }) => c.id === convo.id),
    ).toBe(true)
  })

  it('conversa ocultada reaparece quando chega mensagem nova', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    await makeMessage(convo.id, a.id, { content: 'oi' })
    await app.inject({
      method: 'DELETE',
      url: `/conversations/${convo.id}`,
      headers: auth(a.id),
    })

    await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages`,
      headers: auth(b.id),
      body: { content: 'voltei' },
    })

    const inboxA = await app.inject({
      method: 'GET',
      url: '/conversations',
      headers: auth(a.id),
    })
    expect(
      inboxA.json().data.some((c: { id: string }) => c.id === convo.id),
    ).toBe(true)
  })

  it('DELETE em grupo não remove o membro (continua participante)', async () => {
    const owner = await makeUser()
    const member = await makeUser()
    const group = await makeGroupConversation(owner.id, [member.id])

    await app.inject({
      method: 'DELETE',
      url: `/conversations/${group.id}`,
      headers: auth(member.id),
    })

    // segue membro: consegue ver o detalhe
    const detail = await app.inject({
      method: 'GET',
      url: `/conversations/${group.id}`,
      headers: auth(member.id),
    })
    expect(detail.statusCode).toBe(200)
  })

  it('POST /leave em DM retorna 400', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)

    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/leave`,
      headers: auth(a.id),
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('PATCH editar mensagem (mudança 3)', () => {
  it('autor edita a própria mensagem (200, editedAt, novo conteúdo)', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    const msg = await makeMessage(convo.id, a.id, { content: 'original' })

    const res = await app.inject({
      method: 'PATCH',
      url: `/conversations/${convo.id}/messages/${msg.id}`,
      headers: auth(a.id),
      body: { content: 'editado' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().content).toBe('editado')
    expect(res.json().editedAt).not.toBeNull()
  })

  it('403 ao editar mensagem de outro', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    const msg = await makeMessage(convo.id, a.id, { content: 'x' })

    const res = await app.inject({
      method: 'PATCH',
      url: `/conversations/${convo.id}/messages/${msg.id}`,
      headers: auth(b.id),
      body: { content: 'invadido' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('403 ao editar mensagem apagada', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    const msg = await makeMessage(convo.id, a.id, { content: 'x' })
    await app.inject({
      method: 'DELETE',
      url: `/conversations/${convo.id}/messages/${msg.id}`,
      headers: auth(a.id),
    })

    const res = await app.inject({
      method: 'PATCH',
      url: `/conversations/${convo.id}/messages/${msg.id}`,
      headers: auth(a.id),
      body: { content: 'tentando editar' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('403 ao editar mensagem só de imagem', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    const png = await tinyPngBuffer()
    const { body, contentType } = multipartFormData(
      png,
      'image',
      'foto.png',
      'image/png',
    )
    const sent = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages/images`,
      headers: { ...auth(a.id), 'content-type': contentType },
      payload: body,
    })
    const messageId = sent.json().id

    const res = await app.inject({
      method: 'PATCH',
      url: `/conversations/${convo.id}/messages/${messageId}`,
      headers: auth(a.id),
      body: { content: 'legenda' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('400 conteúdo vazio', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    const msg = await makeMessage(convo.id, a.id, { content: 'x' })

    const res = await app.inject({
      method: 'PATCH',
      url: `/conversations/${convo.id}/messages/${msg.id}`,
      headers: auth(a.id),
      body: { content: '   ' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('404 mensagem inexistente', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)

    const res = await app.inject({
      method: 'PATCH',
      url: `/conversations/${convo.id}/messages/${crypto.randomUUID()}`,
      headers: auth(a.id),
      body: { content: 'oi' },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('recibos entregue/visto', () => {
  it('POST /delivered marca lastDeliveredAt do participante (204)', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    await makeMessage(convo.id, a.id, { content: 'oi' })

    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/delivered`,
      headers: auth(b.id),
    })
    expect(res.statusCode).toBe(204)

    const detail = await app.inject({
      method: 'GET',
      url: `/conversations/${convo.id}`,
      headers: auth(b.id),
    })
    const partB = detail
      .json()
      .participants.find((p: { userId: string }) => p.userId === b.id)
    expect(partB.lastDeliveredAt).not.toBeNull()
    expect(partB.lastReadAt).toBeNull()
  })

  it('marcar como lida também avança lastDeliveredAt', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    await makeMessage(convo.id, a.id, { content: 'oi' })

    await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/read`,
      headers: auth(b.id),
    })

    const detail = await app.inject({
      method: 'GET',
      url: `/conversations/${convo.id}`,
      headers: auth(b.id),
    })
    const partB = detail
      .json()
      .participants.find((p: { userId: string }) => p.userId === b.id)
    expect(partB.lastReadAt).not.toBeNull()
    expect(partB.lastDeliveredAt).not.toBeNull()
  })

  it('401 sem autenticação no /delivered', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${crypto.randomUUID()}/delivered`,
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('reply / citar mensagem', () => {
  it('responde a uma mensagem incluindo replyTo no payload', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    const original = await makeMessage(convo.id, a.id, { content: 'pergunta' })

    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages`,
      headers: auth(b.id),
      body: { content: 'resposta', replyToId: original.id },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().replyToId).toBe(original.id)
    expect(res.json().replyTo).toMatchObject({
      id: original.id,
      content: 'pergunta',
    })
  })

  it('400 ao citar mensagem de outra conversa', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const c = await makeUser()
    const convo1 = await makeDirectConversation(a.id, b.id)
    const convo2 = await makeDirectConversation(a.id, c.id)
    const alheia = await makeMessage(convo2.id, a.id, { content: 'de outra' })

    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${convo1.id}/messages`,
      headers: auth(a.id),
      body: { content: 'tentando', replyToId: alheia.id },
    })
    expect(res.statusCode).toBe(400)
  })

  it('preview do reply some quando a original é apagada (tombstone)', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    const original = await makeMessage(convo.id, a.id, {
      content: 'apagar depois',
    })
    await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages`,
      headers: auth(b.id),
      body: { content: 'resposta', replyToId: original.id },
    })
    await app.inject({
      method: 'DELETE',
      url: `/conversations/${convo.id}/messages/${original.id}`,
      headers: auth(a.id),
    })

    const history = await app.inject({
      method: 'GET',
      url: `/conversations/${convo.id}/messages`,
      headers: auth(b.id),
    })
    const reply = history
      .json()
      .data.find(
        (m: { replyToId: string | null }) => m.replyToId === original.id,
      )
    expect(reply.replyTo.content).toBeNull()
    expect(reply.replyTo.deletedAt).not.toBeNull()
  })
})

describe('reações em mensagem', () => {
  it('adiciona reação (201), aparece na lista e é idempotente', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    const msg = await makeMessage(convo.id, a.id, { content: 'curtir' })

    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages/${msg.id}/reactions`,
      headers: auth(b.id),
      body: { emoji: '👍' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().reactions).toContainEqual({ userId: b.id, emoji: '👍' })

    const again = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages/${msg.id}/reactions`,
      headers: auth(b.id),
      body: { emoji: '👍' },
    })
    expect(again.statusCode).toBe(201)
    expect(
      again.json().reactions.filter((r: { emoji: string }) => r.emoji === '👍'),
    ).toHaveLength(1)
  })

  it('remove reação', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    const msg = await makeMessage(convo.id, a.id, { content: 'curtir' })
    await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages/${msg.id}/reactions`,
      headers: auth(b.id),
      body: { emoji: '👍' },
    })

    const res = await app.inject({
      method: 'DELETE',
      url: `/conversations/${convo.id}/messages/${msg.id}/reactions`,
      headers: auth(b.id),
      body: { emoji: '👍' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().reactions).not.toContainEqual({
      userId: b.id,
      emoji: '👍',
    })
  })

  it('403 ao reagir como não-participante', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const stranger = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    const msg = await makeMessage(convo.id, a.id, { content: 'x' })

    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages/${msg.id}/reactions`,
      headers: auth(stranger.id),
      body: { emoji: '👍' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('404 ao reagir em mensagem inexistente', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)

    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages/${crypto.randomUUID()}/reactions`,
      headers: auth(a.id),
      body: { emoji: '👍' },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('mensagens de sistema em grupo', () => {
  it('adicionar participante gera mensagem SYSTEM', async () => {
    const owner = await makeUser()
    const newcomer = await makeUser()
    const group = await makeGroupConversation(owner.id, [])

    await app.inject({
      method: 'POST',
      url: `/conversations/${group.id}/participants`,
      headers: auth(owner.id),
      body: { userId: newcomer.id },
    })

    const history = await app.inject({
      method: 'GET',
      url: `/conversations/${group.id}/messages`,
      headers: auth(owner.id),
    })
    const sys = history
      .json()
      .data.find((m: { type: string }) => m.type === 'SYSTEM')
    expect(sys).toBeDefined()
    expect(sys.content).toContain('adicionou')
  })

  it('renomear o grupo gera mensagem SYSTEM', async () => {
    const owner = await makeUser()
    const member = await makeUser()
    const group = await makeGroupConversation(owner.id, [member.id])

    await app.inject({
      method: 'PATCH',
      url: `/conversations/${group.id}`,
      headers: auth(owner.id),
      body: { title: 'Renomeado' },
    })

    const history = await app.inject({
      method: 'GET',
      url: `/conversations/${group.id}/messages`,
      headers: auth(member.id),
    })
    const sys = history
      .json()
      .data.find((m: { type: string }) => m.type === 'SYSTEM')
    expect(sys).toBeDefined()
    expect(sys.content).toContain('nome do grupo')
  })

  it('sair do grupo gera mensagem SYSTEM', async () => {
    const owner = await makeUser()
    const member = await makeUser()
    const group = await makeGroupConversation(owner.id, [member.id])

    await app.inject({
      method: 'POST',
      url: `/conversations/${group.id}/leave`,
      headers: auth(member.id),
    })

    const history = await app.inject({
      method: 'GET',
      url: `/conversations/${group.id}/messages`,
      headers: auth(owner.id),
    })
    const sys = history
      .json()
      .data.find((m: { type: string }) => m.type === 'SYSTEM')
    expect(sys).toBeDefined()
    expect(sys.content).toContain('saiu do grupo')
  })

  it('mensagem SYSTEM não conta como não-lida', async () => {
    const owner = await makeUser()
    const member = await makeUser()
    const group = await makeGroupConversation(owner.id, [member.id])

    await app.inject({
      method: 'PATCH',
      url: `/conversations/${group.id}`,
      headers: auth(owner.id),
      body: { title: 'Renomeado' },
    })

    const inbox = await app.inject({
      method: 'GET',
      url: '/conversations',
      headers: auth(member.id),
    })
    const item = inbox
      .json()
      .data.find((c: { id: string }) => c.id === group.id)
    expect(item.unreadCount).toBe(0)
  })

  it('403 ao editar/apagar/reagir mensagem SYSTEM', async () => {
    const owner = await makeUser()
    const newcomer = await makeUser()
    const group = await makeGroupConversation(owner.id, [])
    await app.inject({
      method: 'POST',
      url: `/conversations/${group.id}/participants`,
      headers: auth(owner.id),
      body: { userId: newcomer.id },
    })
    const history = await app.inject({
      method: 'GET',
      url: `/conversations/${group.id}/messages`,
      headers: auth(owner.id),
    })
    const sys = history
      .json()
      .data.find((m: { type: string }) => m.type === 'SYSTEM')

    const edit = await app.inject({
      method: 'PATCH',
      url: `/conversations/${group.id}/messages/${sys.id}`,
      headers: auth(owner.id),
      body: { content: 'hack' },
    })
    expect(edit.statusCode).toBe(403)

    const del = await app.inject({
      method: 'DELETE',
      url: `/conversations/${group.id}/messages/${sys.id}`,
      headers: auth(owner.id),
    })
    expect(del.statusCode).toBe(403)

    const react = await app.inject({
      method: 'POST',
      url: `/conversations/${group.id}/messages/${sys.id}/reactions`,
      headers: auth(owner.id),
      body: { emoji: '👍' },
    })
    expect(react.statusCode).toBe(403)
  })
})

describe('presença respeita bloqueio (findConversationPartnerIds)', () => {
  it('exclui bloqueados em qualquer direção e mantém os demais', async () => {
    const owner = await makeUser()
    const memberA = await makeUser()
    const memberB = await makeUser()
    await makeGroupConversation(owner.id, [memberA.id, memberB.id])

    const before = await findConversationPartnerIds(owner.id)
    expect([...before].sort()).toEqual([memberA.id, memberB.id].sort())

    await makeBlock(owner.id, memberB.id)

    const afterOwner = await findConversationPartnerIds(owner.id)
    expect(afterOwner).toContain(memberA.id)
    expect(afterOwner).not.toContain(memberB.id)

    // bloqueio vale nos dois sentidos: B também não recebe presença do owner
    const afterB = await findConversationPartnerIds(memberB.id)
    expect(afterB).not.toContain(owner.id)
    expect(afterB).toContain(memberA.id)
  })
})

describe('validação de emoji na reação', () => {
  it('aceita emoji ZWJ composto (família)', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    const msg = await makeMessage(convo.id, a.id, { content: 'x' })

    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages/${msg.id}/reactions`,
      headers: auth(b.id),
      body: { emoji: '👨‍👩‍👧‍👦' },
    })
    expect(res.statusCode).toBe(201)
  })

  it('rejeita string acima do limite (400)', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    const msg = await makeMessage(convo.id, a.id, { content: 'x' })

    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages/${msg.id}/reactions`,
      headers: auth(b.id),
      body: { emoji: 'x'.repeat(33) },
    })
    expect(res.statusCode).toBe(400)
  })
})
