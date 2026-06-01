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
import { multipartFormData, tinyPngBuffer } from '../../test/image-fixture'
import { testPrisma } from '../../test/prisma'

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
