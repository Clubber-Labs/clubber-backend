import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { env } from '../../lib/env'
import { CHAT_CHANNEL } from '../../lib/realtime'
import { redis } from '../../lib/redis'
import { buildApp } from '../../test/app'
import {
  makeBlock,
  makeDirectConversation,
  makeFollow,
  makeGroupConversation,
  makeMessage,
  makeUser,
} from '../../test/factories'
import { fakeStorage } from '../../test/fake-storage'
import {
  multipartFormData,
  tinyM4aBuffer,
  tinyPngBuffer,
} from '../../test/image-fixture'
import { testPrisma } from '../../test/prisma'
import {
  findConversationPartnerIds,
  markDeliveredIfBehind,
} from './chat.repository'

let app: FastifyInstance

function token(userId: string) {
  return app.jwt.sign({ sub: userId })
}

function auth(userId: string) {
  return { authorization: `Bearer ${token(userId)}` }
}

type ChatFrame = {
  type: string
  conversationId?: string
  userId?: string
  at?: string
  participantIds?: string[]
}

/**
 * Assina o canal de eventos do chat, executa `action` e resolve com o primeiro
 * frame que casa com `predicate`. Usado para provar que /read e /delivered
 * publicam o recibo em tempo real (a suíte não abre socket real).
 */
async function waitForChatEvent(
  predicate: (frame: ChatFrame) => boolean,
  action: () => Promise<void>,
): Promise<ChatFrame> {
  if (!redis) throw new Error('REDIS_URL é obrigatório nos testes')
  const sub = redis.duplicate()
  try {
    const received = new Promise<ChatFrame>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('timeout esperando evento de chat')),
        2000,
      )
      sub.on('message', (_channel, raw) => {
        const frame = JSON.parse(raw) as ChatFrame
        if (predicate(frame)) {
          clearTimeout(timer)
          resolve(frame)
        }
      })
    })
    await sub.subscribe(CHAT_CHANNEL)
    await action()
    return await received
  } finally {
    await sub.quit()
  }
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
    const attachment = res.json().attachments[0]
    // URL ASSINADA (mídia privada), não a URL pública persistida.
    expect(attachment.url).toContain('/signed/')
    // O publicId (key) é interno — não vaza na resposta.
    expect(attachment.key).toBeUndefined()
    // 1.4: imagem grava width/height (sharp) pro cliente reservar o aspect-ratio.
    expect(attachment.width).toBeGreaterThan(0)
    expect(attachment.height).toBeGreaterThan(0)
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

  it('1.5: GIF é rejeitado → 400 (não aceitamos GIF no chat)', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    const { body, contentType } = multipartFormData(
      Buffer.from('GIF89a-fake-bytes'),
      'image',
      'meme.gif',
      'image/gif',
    )

    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages/images`,
      headers: { ...auth(a.id), 'content-type': contentType },
      payload: body,
    })
    expect(res.statusCode).toBe(400)
  })

  it('1.6: imagem acima de 5 MB → 413 com mensagem em PT', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    // Excede o teto global do multipart (5 MB). O mimetype passa; o toBuffer
    // estoura e o erro do @fastify/multipart é padronizado em PT no handler.
    const big = Buffer.alloc(5 * 1024 * 1024 + 1024, 1)
    const { body, contentType } = multipartFormData(
      big,
      'image',
      'grande.png',
      'image/png',
    )

    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages/images`,
      headers: { ...auth(a.id), 'content-type': contentType },
      payload: body,
    })
    expect(res.statusCode).toBe(413)
    expect(res.json().message).toMatch(/limite/i)
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
    // URL ASSINADA (mídia privada); key não vaza; upload é privado.
    expect(attachment.url).toContain('/signed/')
    expect(attachment.key).toBeUndefined()
    expect(
      fakeStorage.uploads[fakeStorage.uploads.length - 1]?.deliveryType,
    ).toBe('authenticated')
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

  it('conteúdo não é áudio (provider detecta) → 400 e remove o órfão', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    // O mimetype passa (audio/mp4), mas o Cloudinary detecta que o conteúdo real
    // não é mídia (ex.: texto/HTML disfarçado). Não confiamos no Content-Type.
    fakeStorage.forceDetectedResourceType = 'raw'
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
      headers: { ...auth(a.id), 'content-type': contentType },
      payload: body,
    })

    expect(res.statusCode).toBe(400)
    // O asset subiu antes da detecção → foi removido (não vira lixo pago) E com
    // o resource_type DETECTADO ('raw'), senão o destroy não apagaria o órfão.
    expect(fakeStorage.deleted).toHaveLength(1)
    expect(fakeStorage.deletedResources[0]?.resourceType).toBe('raw')
    const count = await testPrisma.message.count({
      where: { conversationId: convo.id },
    })
    expect(count).toBe(0)
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

  it('1.3/1.6: áudio acima de 5 MB → 413 PT e limpa o parcial', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    // Excede 5 MB: o busboy trunca o stream e marca `truncated`. O upload sobe em
    // stream (sem buffer) e, ao ver o truncamento, remove o asset parcial e 413.
    const big = Buffer.alloc(5 * 1024 * 1024 + 1024, 1)
    const { body, contentType } = multipartFormData(
      big,
      'audio',
      'nota.m4a',
      'audio/mp4',
      { durationMs: '3000' },
    )

    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages/audio`,
      headers: { ...auth(a.id), 'content-type': contentType },
      payload: body,
    })

    expect(res.statusCode).toBe(413)
    expect(res.json().message).toMatch(/limite/i)
    // O parcial que subiu foi removido (não vira órfão pago).
    expect(fakeStorage.deleted.length).toBeGreaterThanOrEqual(1)
    // E nada foi persistido.
    const count = await testPrisma.message.count({
      where: { conversationId: convo.id },
    })
    expect(count).toBe(0)
  })

  it('> 5 MB de conteúdo não-mídia: 413 limpa o parcial com o tipo detectado', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    // Não-mídia > 5 MB: o truncamento (413) roda ANTES do content-check, então o
    // parcial precisa ser deletado com o tipo DETECTADO ('raw'), não 'video'.
    fakeStorage.forceDetectedResourceType = 'raw'
    const big = Buffer.alloc(5 * 1024 * 1024 + 1024, 1)
    const { body, contentType } = multipartFormData(
      big,
      'audio',
      'nota.m4a',
      'audio/mp4',
      { durationMs: '3000' },
    )

    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages/audio`,
      headers: { ...auth(a.id), 'content-type': contentType },
      payload: body,
    })

    expect(res.statusCode).toBe(413)
    expect(fakeStorage.deletedResources[0]?.resourceType).toBe('raw')
  })
})

describe('vídeo — upload direto assinado', () => {
  describe('assinatura (POST /messages/video/signature)', () => {
    it('gera assinatura travada na pasta da conversa', async () => {
      const a = await makeUser()
      const b = await makeUser()
      const convo = await makeDirectConversation(a.id, b.id)

      const res = await app.inject({
        method: 'POST',
        url: `/conversations/${convo.id}/messages/video/signature`,
        headers: auth(a.id),
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.signature).toBeTruthy()
      expect(body.timestamp).toBeTruthy()
      expect(body.apiKey).toBeTruthy()
      expect(body.cloudName).toBeTruthy()
      expect(body.resourceType).toBe('video')
      // A pasta é travada pelo backend na conversa — o cliente não a escolhe.
      expect(body.folder).toBe(`conversations/${convo.id}`)
    })

    it('não-participante → 403', async () => {
      const a = await makeUser()
      const b = await makeUser()
      const outsider = await makeUser()
      const convo = await makeDirectConversation(a.id, b.id)

      const res = await app.inject({
        method: 'POST',
        url: `/conversations/${convo.id}/messages/video/signature`,
        headers: auth(outsider.id),
      })
      expect(res.statusCode).toBe(403)
    })

    it('sem autenticação → 401', async () => {
      const a = await makeUser()
      const b = await makeUser()
      const convo = await makeDirectConversation(a.id, b.id)

      const res = await app.inject({
        method: 'POST',
        url: `/conversations/${convo.id}/messages/video/signature`,
      })
      expect(res.statusCode).toBe(401)
    })

    it('conversa inexistente → 404', async () => {
      const a = await makeUser()

      const res = await app.inject({
        method: 'POST',
        url: `/conversations/${randomUUID()}/messages/video/signature`,
        headers: auth(a.id),
      })
      expect(res.statusCode).toBe(404)
    })
  })

  describe('criar mensagem (POST /messages/video)', () => {
    it('cria a mensagem a partir do publicId verificado no provider', async () => {
      const a = await makeUser()
      const b = await makeUser()
      const convo = await makeDirectConversation(a.id, b.id)
      const publicId = `conversations/${convo.id}/${randomUUID()}`

      const res = await app.inject({
        method: 'POST',
        url: `/conversations/${convo.id}/messages/video`,
        headers: auth(a.id),
        body: { publicId },
      })

      expect(res.statusCode).toBe(201)
      const attachment = res.json().attachments[0]
      expect(res.json().attachments).toHaveLength(1)
      expect(attachment.kind).toBe('VIDEO')
      // Metadados vêm do provider (fake), não do cliente.
      expect(attachment.durationMs).toBe(8200)
      expect(attachment.width).toBe(1080)
      expect(attachment.height).toBe(1920)
      expect(attachment.format).toBe('mp4')
      // URL e poster ASSINADOS (mídia privada); key não vaza.
      expect(attachment.url).toContain('/signed/')
      expect(attachment.thumbnailUrl).toContain('/signed/')
      expect(attachment.thumbnailUrl).toMatch(/\.jpg$/)
      expect(attachment.key).toBeUndefined()
    })

    it('publicId de outra conversa → 403', async () => {
      const a = await makeUser()
      const b = await makeUser()
      const convo = await makeDirectConversation(a.id, b.id)
      // publicId aponta para a pasta de OUTRA conversa.
      const publicId = `conversations/${randomUUID()}/${randomUUID()}`

      const res = await app.inject({
        method: 'POST',
        url: `/conversations/${convo.id}/messages/video`,
        headers: auth(a.id),
        body: { publicId },
      })
      expect(res.statusCode).toBe(403)
    })

    it('asset inexistente no provider → 400', async () => {
      const a = await makeUser()
      const b = await makeUser()
      const convo = await makeDirectConversation(a.id, b.id)
      const publicId = `conversations/${convo.id}/missing`

      const res = await app.inject({
        method: 'POST',
        url: `/conversations/${convo.id}/messages/video`,
        headers: auth(a.id),
        body: { publicId },
      })
      expect(res.statusCode).toBe(400)
    })

    it('formato não suportado → 400', async () => {
      const a = await makeUser()
      const b = await makeUser()
      const convo = await makeDirectConversation(a.id, b.id)
      const publicId = `conversations/${convo.id}/badformat`

      const res = await app.inject({
        method: 'POST',
        url: `/conversations/${convo.id}/messages/video`,
        headers: auth(a.id),
        body: { publicId },
      })
      expect(res.statusCode).toBe(400)
    })

    it('vídeo acima do limite → 413', async () => {
      const a = await makeUser()
      const b = await makeUser()
      const convo = await makeDirectConversation(a.id, b.id)
      const publicId = `conversations/${convo.id}/toobig`

      const res = await app.inject({
        method: 'POST',
        url: `/conversations/${convo.id}/messages/video`,
        headers: auth(a.id),
        body: { publicId },
      })
      expect(res.statusCode).toBe(413)
    })

    it('não-participante → 403', async () => {
      const a = await makeUser()
      const b = await makeUser()
      const outsider = await makeUser()
      const convo = await makeDirectConversation(a.id, b.id)
      const publicId = `conversations/${convo.id}/${randomUUID()}`

      const res = await app.inject({
        method: 'POST',
        url: `/conversations/${convo.id}/messages/video`,
        headers: auth(outsider.id),
        body: { publicId },
      })
      expect(res.statusCode).toBe(403)
    })

    it('sem autenticação → 401', async () => {
      const a = await makeUser()
      const b = await makeUser()
      const convo = await makeDirectConversation(a.id, b.id)

      const res = await app.inject({
        method: 'POST',
        url: `/conversations/${convo.id}/messages/video`,
        body: { publicId: `conversations/${convo.id}/${randomUUID()}` },
      })
      expect(res.statusCode).toBe(401)
    })

    it('publicId vazio → 400', async () => {
      const a = await makeUser()
      const b = await makeUser()
      const convo = await makeDirectConversation(a.id, b.id)

      const res = await app.inject({
        method: 'POST',
        url: `/conversations/${convo.id}/messages/video`,
        headers: auth(a.id),
        body: { publicId: '' },
      })
      expect(res.statusCode).toBe(400)
    })

    it('publicId só de espaços → 400 (trim no boundary)', async () => {
      const a = await makeUser()
      const b = await makeUser()
      const convo = await makeDirectConversation(a.id, b.id)

      const res = await app.inject({
        method: 'POST',
        url: `/conversations/${convo.id}/messages/video`,
        headers: auth(a.id),
        body: { publicId: '   ' },
      })
      expect(res.statusCode).toBe(400)
    })

    // Modo de pasta DINÂMICA do Cloudinary (padrão para contas novas): o
    // public_id NÃO inclui o caminho; a pasta vem em asset_folder. O
    // pertencimento depende do ramo `asset.folder === folder` — este teste
    // falha se alguém removê-lo (a regressão que a revisão tentou introduzir).
    it('aceita asset em pasta dinâmica (publicId sem caminho + asset_folder)', async () => {
      const a = await makeUser()
      const b = await makeUser()
      const convo = await makeDirectConversation(a.id, b.id)
      const publicId = `dyn::conversations/${convo.id}::${randomUUID()}`

      const res = await app.inject({
        method: 'POST',
        url: `/conversations/${convo.id}/messages/video`,
        headers: auth(a.id),
        body: { publicId },
      })

      expect(res.statusCode).toBe(201)
      expect(res.json().attachments[0].kind).toBe('VIDEO')
    })

    it('pasta dinâmica: asset_folder de outra conversa → 403', async () => {
      const a = await makeUser()
      const b = await makeUser()
      const convo = await makeDirectConversation(a.id, b.id)
      const publicId = `dyn::conversations/${randomUUID()}::${randomUUID()}`

      const res = await app.inject({
        method: 'POST',
        url: `/conversations/${convo.id}/messages/video`,
        headers: auth(a.id),
        body: { publicId },
      })
      expect(res.statusCode).toBe(403)
    })

    it('mensagem só de vídeo não pode ser editada → 403', async () => {
      const a = await makeUser()
      const b = await makeUser()
      const convo = await makeDirectConversation(a.id, b.id)
      const publicId = `conversations/${convo.id}/${randomUUID()}`

      const created = await app.inject({
        method: 'POST',
        url: `/conversations/${convo.id}/messages/video`,
        headers: auth(a.id),
        body: { publicId },
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

  it('401 sem autenticação no /read', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${crypto.randomUUID()}/read`,
    })
    expect(res.statusCode).toBe(401)
  })

  it('403 quando quem marca lido não participa da conversa', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const stranger = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)

    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/read`,
      headers: auth(stranger.id),
    })
    expect(res.statusCode).toBe(403)
  })

  it('403 quando quem marca entrega não participa da conversa', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const stranger = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)

    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/delivered`,
      headers: auth(stranger.id),
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('recibos em tempo real (frames WS)', () => {
  it('POST /delivered publica frame delivered com userId e at', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    await makeMessage(convo.id, a.id, { content: 'oi' })

    const frame = await waitForChatEvent(
      (f) =>
        f.type === 'delivered' &&
        f.conversationId === convo.id &&
        f.userId === b.id,
      async () => {
        await app.inject({
          method: 'POST',
          url: `/conversations/${convo.id}/delivered`,
          headers: auth(b.id),
        })
      },
    )

    expect(typeof frame.at).toBe('string')
    expect(frame.participantIds).toEqual(expect.arrayContaining([a.id, b.id]))
  })

  it('POST /read publica frame read com userId e at', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    await makeMessage(convo.id, a.id, { content: 'oi' })

    const frame = await waitForChatEvent(
      (f) =>
        f.type === 'read' && f.conversationId === convo.id && f.userId === b.id,
      async () => {
        await app.inject({
          method: 'POST',
          url: `/conversations/${convo.id}/read`,
          headers: auth(b.id),
        })
      },
    )

    expect(typeof frame.at).toBe('string')
  })
})

describe('markDeliveredIfBehind (entrega monotônica)', () => {
  it('avança quando atrás de upTo e não regride quando já cobre', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    const past = new Date(Date.now() - 60_000)
    const future = new Date(Date.now() + 60_000)

    // B nunca recebeu → está atrás de `past` → avança e retorna o novo watermark
    const first = await markDeliveredIfBehind(convo.id, b.id, past)
    expect(first).toBeInstanceOf(Date)

    // Mesmo `upTo` no passado, já coberto → null (não regride nem duplica frame)
    const again = await markDeliveredIfBehind(convo.id, b.id, past)
    expect(again).toBeNull()

    // Mensagem mais nova (futuro) ainda não coberta → avança de novo
    const advanced = await markDeliveredIfBehind(convo.id, b.id, future)
    expect(advanced).toBeInstanceOf(Date)
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

describe('ciclo de vida de mídia (auditoria 1.1/1.2)', () => {
  it('apagar mensagem de áudio remove o arquivo (resource_type video)', async () => {
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
    expect(created.statusCode).toBe(201)
    const key = fakeStorage.uploads[0].key

    const del = await app.inject({
      method: 'DELETE',
      url: `/conversations/${convo.id}/messages/${created.json().id}`,
      headers: auth(a.id),
    })
    expect(del.statusCode).toBe(204)
    // 1.1: áudio é resource_type 'video' no Cloudinary (destroy com tipo certo).
    expect(fakeStorage.deletedResources).toContainEqual({
      key,
      resourceType: 'video',
    })
  })

  it('apagar mensagem de imagem remove o arquivo (resource_type image)', async () => {
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
    const created = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages/images`,
      headers: { ...auth(a.id), 'content-type': contentType },
      payload: body,
    })
    const key = fakeStorage.uploads[0].key

    const del = await app.inject({
      method: 'DELETE',
      url: `/conversations/${convo.id}/messages/${created.json().id}`,
      headers: auth(a.id),
    })
    expect(del.statusCode).toBe(204)
    expect(fakeStorage.deletedResources).toContainEqual({
      key,
      resourceType: 'image',
    })
  })

  it('falha no insert pós-upload dispara delete compensatório', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    // O provider reporta um tamanho que estoura o int4 → o insert do attachment
    // falha DEPOIS do upload, exercitando o caminho compensatório.
    fakeStorage.forceOversizeBytes = true
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
      headers: { ...auth(a.id), 'content-type': contentType },
      payload: body,
    })

    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    // O asset que subiu foi removido (compensatório) e nada persistiu.
    expect(fakeStorage.uploads).toHaveLength(1)
    expect(fakeStorage.deleted).toContain(fakeStorage.uploads[0].key)
    const count = await testPrisma.message.count({
      where: { conversationId: convo.id },
    })
    expect(count).toBe(0)
  })
})

describe('idempotência de envio (Fase 2 #7)', () => {
  const idem = (userId: string, key: string) => ({
    ...auth(userId),
    'idempotency-key': key,
  })

  it('texto: mesma Idempotency-Key não duplica (devolve a mesma mensagem)', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)

    const first = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages`,
      headers: idem(a.id, 'key-1'),
      body: { content: 'oi' },
    })
    const second = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages`,
      headers: idem(a.id, 'key-1'),
      body: { content: 'oi' },
    })

    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(201)
    expect(second.json().id).toBe(first.json().id)
    const count = await testPrisma.message.count({
      where: { conversationId: convo.id },
    })
    expect(count).toBe(1)
  })

  it('texto: sem Idempotency-Key, dois envios iguais duplicam', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)

    for (let i = 0; i < 2; i++) {
      await app.inject({
        method: 'POST',
        url: `/conversations/${convo.id}/messages`,
        headers: auth(a.id),
        body: { content: 'oi' },
      })
    }
    const count = await testPrisma.message.count({
      where: { conversationId: convo.id },
    })
    expect(count).toBe(2)
  })

  it('texto: keys diferentes criam mensagens diferentes', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)

    const r1 = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages`,
      headers: idem(a.id, 'k1'),
      body: { content: 'oi' },
    })
    const r2 = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages`,
      headers: idem(a.id, 'k2'),
      body: { content: 'oi' },
    })
    expect(r2.json().id).not.toBe(r1.json().id)
    const count = await testPrisma.message.count({
      where: { conversationId: convo.id },
    })
    expect(count).toBe(2)
  })

  it('imagem: retry com a mesma key não re-sobe o arquivo nem duplica', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    const png = await tinyPngBuffer()

    const send = () => {
      const { body, contentType } = multipartFormData(
        png,
        'image',
        'foto.png',
        'image/png',
      )
      return app.inject({
        method: 'POST',
        url: `/conversations/${convo.id}/messages/images`,
        headers: { ...idem(a.id, 'img-1'), 'content-type': contentType },
        payload: body,
      })
    }

    const first = await send()
    const second = await send()

    expect(second.json().id).toBe(first.json().id)
    // Dedup ANTES do upload: o segundo nem sobe o arquivo.
    expect(fakeStorage.uploads).toHaveLength(1)
    const count = await testPrisma.message.count({
      where: { conversationId: convo.id },
    })
    expect(count).toBe(1)
  })

  it('Idempotency-Key acima de 200 chars → 400', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)

    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages`,
      headers: idem(a.id, 'x'.repeat(201)),
      body: { content: 'oi' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('a mesma key em conversas diferentes não colide', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const c = await makeUser()
    const convo1 = await makeDirectConversation(a.id, b.id)
    const convo2 = await makeDirectConversation(a.id, c.id)

    const r1 = await app.inject({
      method: 'POST',
      url: `/conversations/${convo1.id}/messages`,
      headers: idem(a.id, 'same'),
      body: { content: 'um' },
    })
    const r2 = await app.inject({
      method: 'POST',
      url: `/conversations/${convo2.id}/messages`,
      headers: idem(a.id, 'same'),
      body: { content: 'dois' },
    })
    expect(r1.statusCode).toBe(201)
    expect(r2.statusCode).toBe(201)
    expect(r2.json().id).not.toBe(r1.json().id)
  })

  it('áudio: retry com a mesma key não re-sobe o arquivo nem duplica', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)

    const send = () => {
      const { body, contentType } = multipartFormData(
        tinyM4aBuffer(),
        'audio',
        'nota.m4a',
        'audio/mp4',
        { durationMs: '1000' },
      )
      return app.inject({
        method: 'POST',
        url: `/conversations/${convo.id}/messages/audio`,
        headers: { ...idem(a.id, 'aud-1'), 'content-type': contentType },
        payload: body,
      })
    }

    const first = await send()
    const second = await send()

    expect(first.statusCode).toBe(201)
    expect(second.json().id).toBe(first.json().id)
    // Dedup ANTES do upload: o segundo nem sobe o arquivo.
    expect(fakeStorage.uploads).toHaveLength(1)
    const count = await testPrisma.message.count({
      where: { conversationId: convo.id },
    })
    expect(count).toBe(1)
  })

  it('vídeo: retry com a mesma key não duplica', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    const publicId = `conversations/${convo.id}/${randomUUID()}`

    const send = () =>
      app.inject({
        method: 'POST',
        url: `/conversations/${convo.id}/messages/video`,
        headers: idem(a.id, 'vid-1'),
        body: { publicId },
      })

    const first = await send()
    const second = await send()

    expect(first.statusCode).toBe(201)
    expect(second.json().id).toBe(first.json().id)
    const count = await testPrisma.message.count({
      where: { conversationId: convo.id },
    })
    expect(count).toBe(1)
  })
})

describe('mídia privada — URLs assinadas e revogação (Fase 2 #1)', () => {
  it('imagem de chat sobe como authenticated (privada)', async () => {
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
    await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages/images`,
      headers: { ...auth(a.id), 'content-type': contentType },
      payload: body,
    })
    expect(
      fakeStorage.uploads[fakeStorage.uploads.length - 1]?.deliveryType,
    ).toBe('authenticated')
  })

  it('áudio de chat sobe como authenticated (privada)', async () => {
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
    await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages/audio`,
      headers: { ...auth(a.id), 'content-type': contentType },
      payload: body,
    })
    expect(
      fakeStorage.uploads[fakeStorage.uploads.length - 1]?.deliveryType,
    ).toBe('authenticated')
  })

  it('assinatura de vídeo força entrega authenticated', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)

    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages/video/signature`,
      headers: auth(a.id),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().type).toBe('authenticated')
  })

  it('a mesma mídia é servida com URL assinada em list e inbox', async () => {
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
    await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages/images`,
      headers: { ...auth(a.id), 'content-type': contentType },
      payload: body,
    })

    const list = await app.inject({
      method: 'GET',
      url: `/conversations/${convo.id}/messages`,
      headers: auth(b.id),
    })
    expect(list.json().data[0].attachments[0].url).toContain('/signed/')

    const inbox = await app.inject({
      method: 'GET',
      url: '/conversations',
      headers: auth(b.id),
    })
    const item = inbox
      .json()
      .data.find((c: { id: string }) => c.id === convo.id)
    expect(item.lastMessage.attachments[0].url).toContain('/signed/')
  })

  it('quem saiu do grupo deixa de obter a URL da mídia (403)', async () => {
    const owner = await makeUser()
    const member = await makeUser()
    const group = await makeGroupConversation(owner.id, [member.id])
    const png = await tinyPngBuffer()
    const { body, contentType } = multipartFormData(
      png,
      'image',
      'foto.png',
      'image/png',
    )
    await app.inject({
      method: 'POST',
      url: `/conversations/${group.id}/messages/images`,
      headers: { ...auth(owner.id), 'content-type': contentType },
      payload: body,
    })

    // Enquanto participa, o membro obtém a URL assinada.
    const before = await app.inject({
      method: 'GET',
      url: `/conversations/${group.id}/messages`,
      headers: auth(member.id),
    })
    expect(before.statusCode).toBe(200)
    expect(before.json().data[0].attachments[0].url).toContain('/signed/')

    // Ao sair, perde o acesso ao read path → nunca recebe URL nova (revogação).
    await app.inject({
      method: 'POST',
      url: `/conversations/${group.id}/leave`,
      headers: auth(member.id),
    })
    const after = await app.inject({
      method: 'GET',
      url: `/conversations/${group.id}/messages`,
      headers: auth(member.id),
    })
    expect(after.statusCode).toBe(403)
  })
})

describe('cota de armazenamento por usuário (Fase 2 #6)', () => {
  // Semeia mídia de `senderId` com um tamanho dado (sem subir arquivo de fato).
  async function seedMedia(
    convoId: string,
    senderId: string,
    size: number,
    opts: { deleted?: boolean } = {},
  ) {
    const msg = await makeMessage(convoId, senderId, { content: 'seed' })
    await testPrisma.messageAttachment.create({
      data: {
        messageId: msg.id,
        kind: 'IMAGE',
        url: 'https://x/y.webp',
        key: `seed-${msg.id}`,
        format: 'webp',
        size,
        waveform: [],
        order: 0,
      },
    })
    if (opts.deleted) {
      await testPrisma.message.update({
        where: { id: msg.id },
        data: { deletedAt: new Date() },
      })
    }
    return msg
  }

  const sendImage = async (userId: string, convoId: string) => {
    const png = await tinyPngBuffer()
    const { body, contentType } = multipartFormData(
      png,
      'image',
      'foto.png',
      'image/png',
    )
    return app.inject({
      method: 'POST',
      url: `/conversations/${convoId}/messages/images`,
      headers: { ...auth(userId), 'content-type': contentType },
      payload: body,
    })
  }

  it('recusa upload quando o usuário atinge a cota → 413', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    await seedMedia(convo.id, a.id, env.CHAT_USER_STORAGE_QUOTA_BYTES)

    const res = await sendImage(a.id, convo.id)
    expect(res.statusCode).toBe(413)
    // Nada novo foi subido (recusado antes do upload).
    expect(fakeStorage.uploads).toHaveLength(0)
  })

  it('a cota conta só a mídia do próprio usuário', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    // B enche a própria cota; não deve afetar o A.
    await seedMedia(convo.id, b.id, env.CHAT_USER_STORAGE_QUOTA_BYTES)

    const res = await sendImage(a.id, convo.id)
    expect(res.statusCode).toBe(201)
  })

  it('mídia de mensagem apagada não conta para a cota', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    // A já teve mídia do tamanho da cota, mas a mensagem foi apagada.
    await seedMedia(convo.id, a.id, env.CHAT_USER_STORAGE_QUOTA_BYTES, {
      deleted: true,
    })

    const res = await sendImage(a.id, convo.id)
    expect(res.statusCode).toBe(201)
  })

  it('vídeo: atinge a cota → 413 e remove o asset órfão do provider', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    await seedMedia(convo.id, a.id, env.CHAT_USER_STORAGE_QUOTA_BYTES)
    const publicId = `conversations/${convo.id}/${randomUUID()}`
    const deletedBefore = fakeStorage.deleted.length

    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages/video`,
      headers: auth(a.id),
      body: { publicId },
    })

    expect(res.statusCode).toBe(413)
    // O asset subido pelo cliente virou órfão (recusamos a mensagem) → removido.
    expect(fakeStorage.deleted).toContain(publicId)
    expect(fakeStorage.deleted.length).toBeGreaterThan(deletedBefore)
    // Nenhuma mensagem de vídeo foi persistida.
    const videoMsgs = await testPrisma.message.count({
      where: {
        conversationId: convo.id,
        attachments: { some: { kind: 'VIDEO' } },
      },
    })
    expect(videoMsgs).toBe(0)
  })

  it('corrida: uploads concorrentes do mesmo usuário NÃO furam a cota', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)

    // Descobre o tamanho de uma imagem processada via um probe de OUTRO usuário
    // (não consome a cota do A).
    const probeUser = await makeUser()
    const probeConvo = await makeDirectConversation(probeUser.id, b.id)
    const probe = await sendImage(probeUser.id, probeConvo.id)
    const imgSize: number = probe.json().attachments[0].size

    // A começa com espaço para EXATAMENTE 1 imagem (não 2).
    await seedMedia(
      convo.id,
      a.id,
      env.CHAT_USER_STORAGE_QUOTA_BYTES - imgSize - Math.floor(imgSize / 2),
    )

    // 3 envios concorrentes. Sem o lock, todos leriam o mesmo uso e passariam,
    // furando o teto; com o advisory lock, só 1 cabe.
    const results = await Promise.all([
      sendImage(a.id, convo.id),
      sendImage(a.id, convo.id),
      sendImage(a.id, convo.id),
    ])
    const created = results.filter((r) => r.statusCode === 201).length
    const rejected = results.filter((r) => r.statusCode === 413).length
    expect(created).toBe(1)
    expect(rejected).toBe(2)

    // Invariante: o uso final do A não passa da cota.
    const finalUsed = await testPrisma.messageAttachment.aggregate({
      _sum: { size: true },
      where: { message: { senderId: a.id, deletedAt: null } },
    })
    expect(finalUsed._sum.size ?? 0).toBeLessThanOrEqual(
      env.CHAT_USER_STORAGE_QUOTA_BYTES,
    )
  })
})
