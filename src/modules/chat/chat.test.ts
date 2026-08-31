import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
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
  findTypingRecipientUserIds,
  markDeliveredBatchIfBehind,
  UNREAD_COUNT_CAP,
} from './chat.repository'

let app: FastifyInstance

function token(userId: string) {
  return app.jwt.sign({ sub: userId })
}

function auth(userId: string) {
  return { authorization: `Bearer ${token(userId)}` }
}

/**
 * Multipart de confirmação de vídeo: campos de texto (key/durationMs/...) e um
 * `poster` de arquivo OPCIONAL — espelha multipartFormData, mas sem exigir um
 * arquivo (o endpoint usa request.parts(), não request.file()).
 */
function videoMultipart(
  fields: Record<string, string>,
  poster?: { buffer: Buffer; filename: string; mimetype: string },
) {
  const boundary = `----TestBoundary${Math.random().toString(36).slice(2)}`
  const parts: Buffer[] = []
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    )
  }
  if (poster) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="poster"; filename="${poster.filename}"\r\nContent-Type: ${poster.mimetype}\r\n\r\n`,
      ),
    )
    parts.push(poster.buffer)
    parts.push(Buffer.from('\r\n'))
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`))
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

type ChatFrame = {
  type: string
  conversationId?: string
  userId?: string
  userIds?: string[]
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

  it('403 ao iniciar DM com perfil privado sem follow mútuo', async () => {
    const viewer = await makeUser()
    const target = await makeUser({ isPrivate: true })
    await makeFollow(viewer.id, target.id, 'ACCEPTED')

    const res = await app.inject({
      method: 'POST',
      url: '/conversations',
      headers: auth(viewer.id),
      body: { type: 'DIRECT', targetUserId: target.id },
    })
    expect(res.statusCode).toBe(403)
  })

  it('permite DM com perfil privado em follow mútuo', async () => {
    const viewer = await makeUser()
    const target = await makeUser({ isPrivate: true })
    await makeFollow(viewer.id, target.id, 'ACCEPTED')
    await makeFollow(target.id, viewer.id, 'ACCEPTED')

    const res = await app.inject({
      method: 'POST',
      url: '/conversations',
      headers: auth(viewer.id),
      body: { type: 'DIRECT', targetUserId: target.id },
    })
    expect(res.statusCode).toBe(201)
  })

  it('permite DM com perfil público sem follow nenhum', async () => {
    const viewer = await makeUser()
    const target = await makeUser()

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

  it('satura a contagem no teto em vez de varrer a conversa inteira', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)

    for (let i = 0; i < UNREAD_COUNT_CAP + 5; i++) {
      await makeMessage(convo.id, a.id, { content: `m${i}` })
    }

    const inbox = await app.inject({
      method: 'GET',
      url: '/conversations',
      headers: auth(b.id),
    })
    const item = inbox
      .json()
      .data.find((c: { id: string }) => c.id === convo.id)
    expect(item.unreadCount).toBe(UNREAD_COUNT_CAP)
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

  it('participantes vêm em ordem estável: joinedAt, desempatado por userId', async () => {
    const owner = await makeUser()
    const members = [await makeUser(), await makeUser(), await makeUser()]
    // Criador e membros iniciais nascem na mesma transação → joinedAt idêntico.
    const group = await makeGroupConversation(
      owner.id,
      members.map((m) => m.id),
    )
    const initialIds = [owner.id, ...members.map((m) => m.id)].sort()

    const newcomer = await makeUser()
    await app.inject({
      method: 'POST',
      url: `/conversations/${group.id}/participants`,
      headers: auth(owner.id),
      body: { userId: newcomer.id },
    })
    const expected = [...initialIds, newcomer.id]

    for (let call = 0; call < 3; call++) {
      const detail = await app.inject({
        method: 'GET',
        url: `/conversations/${group.id}`,
        headers: auth(owner.id),
      })
      expect(detail.statusCode).toBe(200)
      expect(
        detail.json().participants.map((p: { userId: string }) => p.userId),
      ).toEqual(expected)

      const inbox = await app.inject({
        method: 'GET',
        url: '/conversations',
        headers: auth(owner.id),
      })
      expect(inbox.statusCode).toBe(200)
      const found = inbox
        .json()
        .data.find((c: { id: string }) => c.id === group.id)
      expect(
        found.participants.map((p: { userId: string }) => p.userId),
      ).toEqual(expected)
    }
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

  it('saída do último admin passa o bastão pro participante mais antigo', async () => {
    const owner = await makeUser()
    const primeiro = await makeUser()
    const segundo = await makeUser()
    const group = await makeGroupConversation(owner.id, [])
    // Entradas sequenciais: joinedAt distinto define quem é o mais antigo.
    for (const membro of [primeiro, segundo]) {
      const added = await app.inject({
        method: 'POST',
        url: `/conversations/${group.id}/participants`,
        headers: auth(owner.id),
        body: { userId: membro.id },
      })
      expect(added.statusCode).toBe(201)
    }

    const left = await app.inject({
      method: 'POST',
      url: `/conversations/${group.id}/leave`,
      headers: auth(owner.id),
    })
    expect(left.statusCode).toBe(204)

    // O bastão tem que ser efetivo, não só o campo: renomear é ação de admin.
    const renomeia = await app.inject({
      method: 'PATCH',
      url: `/conversations/${group.id}`,
      headers: auth(primeiro.id),
      body: { title: 'Grupo do primeiro' },
    })
    expect(renomeia.statusCode).toBe(200)

    const semBastao = await app.inject({
      method: 'PATCH',
      url: `/conversations/${group.id}`,
      headers: auth(segundo.id),
      body: { title: 'Grupo do segundo' },
    })
    expect(semBastao.statusCode).toBe(403)
  })

  it('saída de admin não promove ninguém enquanto sobra outro admin', async () => {
    const owner = await makeUser()
    const antigo = await makeUser()
    const coadmin = await makeUser()
    const group = await makeGroupConversation(owner.id, [antigo.id, coadmin.id])

    const promoveu = await app.inject({
      method: 'PATCH',
      url: `/conversations/${group.id}/participants/${coadmin.id}`,
      headers: auth(owner.id),
      body: { role: 'ADMIN' },
    })
    expect(promoveu.statusCode).toBe(200)

    await app.inject({
      method: 'POST',
      url: `/conversations/${group.id}/leave`,
      headers: auth(owner.id),
    })

    const semBastao = await app.inject({
      method: 'PATCH',
      url: `/conversations/${group.id}`,
      headers: auth(antigo.id),
      body: { title: 'Grupo do antigo' },
    })
    expect(semBastao.statusCode).toBe(403)
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
    expect(res.json().code).toBe('FILE_TOO_LARGE')
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
    // O asset subiu antes da detecção → foi removido (não vira lixo pago).
    expect(fakeStorage.deleted).toHaveLength(1)
    // Mídia de chat é privada: a limpeza precisa mirar o namespace 'authenticated'.
    expect(fakeStorage.deletedResources[0]?.deliveryType).toBe('authenticated')
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
    // code fixo + field apontando o campo inválido: o cliente traduz pelo code
    // e ainda sabe qual metadado rejeitar (sem mensagem livre do Zod).
    expect(res.json()).toMatchObject({
      code: 'INVALID_AUDIO_METADATA',
      field: 'durationMs',
    })
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
    expect(res.json().code).toBe('FILE_TOO_LARGE')
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
    // Mídia de chat é privada: a limpeza precisa mirar o namespace 'authenticated'.
    expect(fakeStorage.deletedResources[0]?.deliveryType).toBe('authenticated')
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
        body: { mimetype: 'video/mp4' },
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.uploadUrl).toBeTruthy()
      expect(body.expiresAt).toBeTruthy()
      // A pasta é travada pelo backend na conversa — o cliente não a escolhe.
      expect(body.key.startsWith(`conversations/${convo.id}/`)).toBe(true)
    })

    it('sem body → 400', async () => {
      const a = await makeUser()
      const b = await makeUser()
      const convo = await makeDirectConversation(a.id, b.id)

      const res = await app.inject({
        method: 'POST',
        url: `/conversations/${convo.id}/messages/video/signature`,
        headers: auth(a.id),
        body: {},
      })
      expect(res.statusCode).toBe(400)
    })

    it('mimetype fora da allowlist → 400', async () => {
      const a = await makeUser()
      const b = await makeUser()
      const convo = await makeDirectConversation(a.id, b.id)

      const res = await app.inject({
        method: 'POST',
        url: `/conversations/${convo.id}/messages/video/signature`,
        headers: auth(a.id),
        body: { mimetype: 'video/x-msvideo' },
      })
      expect(res.statusCode).toBe(400)
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
        body: { mimetype: 'video/mp4' },
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
        body: { mimetype: 'video/mp4' },
      })
      expect(res.statusCode).toBe(401)
    })

    it('conversa inexistente → 404', async () => {
      const a = await makeUser()

      const res = await app.inject({
        method: 'POST',
        url: `/conversations/${randomUUID()}/messages/video/signature`,
        headers: auth(a.id),
        body: { mimetype: 'video/mp4' },
      })
      expect(res.statusCode).toBe(404)
    })
  })

  describe('criar mensagem (POST /messages/video)', () => {
    const sendVideo = async (
      userId: string,
      convoId: string,
      fields: Record<string, string>,
      opts: { poster?: boolean; headers?: Record<string, string> } = {},
    ) => {
      const poster = opts.poster
        ? {
            buffer: await tinyPngBuffer(),
            filename: 'poster.png',
            mimetype: 'image/png',
          }
        : undefined
      const { body, contentType } = videoMultipart(fields, poster)
      return app.inject({
        method: 'POST',
        url: `/conversations/${convoId}/messages/video`,
        headers: {
          ...auth(userId),
          ...opts.headers,
          'content-type': contentType,
        },
        payload: body,
      })
    }

    it('cria a mensagem a partir da key verificada no provider (sem poster)', async () => {
      const a = await makeUser()
      const b = await makeUser()
      const convo = await makeDirectConversation(a.id, b.id)
      const key = `conversations/${convo.id}/${randomUUID()}.mp4`

      const res = await sendVideo(a.id, convo.id, {
        key,
        durationMs: '8200',
        width: '1080',
        height: '1920',
      })

      expect(res.statusCode).toBe(201)
      const attachment = res.json().attachments[0]
      expect(res.json().attachments).toHaveLength(1)
      expect(attachment.kind).toBe('VIDEO')
      // Duração/dimensões vêm do CLIENTE (cosmético, sem poster para conferir).
      expect(attachment.durationMs).toBe(8200)
      expect(attachment.width).toBe(1080)
      expect(attachment.height).toBe(1920)
      expect(attachment.format).toBe('mp4')
      // URL ASSINADA (mídia privada); key não vaza.
      expect(attachment.url).toContain('/signed/')
      expect(attachment.key).toBeUndefined()
      // Sem poster enviado: sem thumbnail.
      expect(attachment.thumbnailUrl).toBeNull()
    })

    it('cria a mensagem COM poster: thumbnailUrl assinada aponta pra key do poster', async () => {
      const a = await makeUser()
      const b = await makeUser()
      const convo = await makeDirectConversation(a.id, b.id)
      const key = `conversations/${convo.id}/${randomUUID()}.mp4`

      const res = await sendVideo(a.id, convo.id, { key }, { poster: true })

      expect(res.statusCode).toBe(201)
      const attachment = res.json().attachments[0]
      expect(attachment.kind).toBe('VIDEO')
      // O poster sobe pelo MESMO pipeline da imagem de chat (privado).
      const posterUpload = fakeStorage.uploads[fakeStorage.uploads.length - 1]
      expect(posterUpload.deliveryType).toBe('authenticated')
      expect(attachment.thumbnailUrl).toBe(
        `https://fake.storage/signed/${posterUpload.key}`,
      )
    })

    it('metadados ausentes (durationMs/width/height) → null', async () => {
      const a = await makeUser()
      const b = await makeUser()
      const convo = await makeDirectConversation(a.id, b.id)
      const key = `conversations/${convo.id}/${randomUUID()}.mp4`

      const res = await sendVideo(a.id, convo.id, { key })

      expect(res.statusCode).toBe(201)
      const attachment = res.json().attachments[0]
      expect(attachment.durationMs).toBeNull()
      expect(attachment.width).toBeNull()
      expect(attachment.height).toBeNull()
    })

    it('apagar mensagem de vídeo remove o vídeo E o poster (authenticated)', async () => {
      const a = await makeUser()
      const b = await makeUser()
      const convo = await makeDirectConversation(a.id, b.id)
      const key = `conversations/${convo.id}/${randomUUID()}.mp4`

      const created = await sendVideo(a.id, convo.id, { key }, { poster: true })
      expect(created.statusCode).toBe(201)
      const posterKey = created
        .json()
        .attachments[0].thumbnailUrl.replace('https://fake.storage/signed/', '')

      const del = await app.inject({
        method: 'DELETE',
        url: `/conversations/${convo.id}/messages/${created.json().id}`,
        headers: auth(a.id),
      })
      expect(del.statusCode).toBe(204)
      // Vídeo é privado → o destroy precisa de 'authenticated', senão o asset
      // do cliente vira órfão pago. O poster (key própria) também é limpo.
      expect(fakeStorage.deletedResources).toContainEqual({
        key,
        deliveryType: 'authenticated',
      })
      expect(fakeStorage.deletedResources).toContainEqual({
        key: posterKey,
        deliveryType: 'authenticated',
      })
    })

    it('key de outra conversa → 403', async () => {
      const a = await makeUser()
      const b = await makeUser()
      const convo = await makeDirectConversation(a.id, b.id)
      // A key aponta para a pasta de OUTRA conversa.
      const key = `conversations/${randomUUID()}/${randomUUID()}.mp4`

      const res = await sendVideo(a.id, convo.id, { key })
      expect(res.statusCode).toBe(403)
    })

    it('vídeo inexistente no provedor → 400', async () => {
      const a = await makeUser()
      const b = await makeUser()
      const convo = await makeDirectConversation(a.id, b.id)
      const key = `conversations/${convo.id}/missing.mp4`

      const res = await sendVideo(a.id, convo.id, { key })
      expect(res.statusCode).toBe(400)
    })

    it('formato não suportado → 400', async () => {
      const a = await makeUser()
      const b = await makeUser()
      const convo = await makeDirectConversation(a.id, b.id)
      const key = `conversations/${convo.id}/badformat.mp4`

      const res = await sendVideo(a.id, convo.id, { key })
      expect(res.statusCode).toBe(400)
    })

    it('vídeo acima do limite → 413', async () => {
      const a = await makeUser()
      const b = await makeUser()
      const convo = await makeDirectConversation(a.id, b.id)
      const key = `conversations/${convo.id}/toobig.mp4`

      const res = await sendVideo(a.id, convo.id, { key })
      expect(res.statusCode).toBe(413)
    })

    it('poster com mimetype inválido → 400', async () => {
      const a = await makeUser()
      const b = await makeUser()
      const convo = await makeDirectConversation(a.id, b.id)
      const key = `conversations/${convo.id}/${randomUUID()}.mp4`
      const { body, contentType } = videoMultipart(
        { key },
        {
          buffer: Buffer.from('not an image'),
          filename: 'poster.txt',
          mimetype: 'text/plain',
        },
      )

      const res = await app.inject({
        method: 'POST',
        url: `/conversations/${convo.id}/messages/video`,
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
      const key = `conversations/${convo.id}/${randomUUID()}.mp4`

      const res = await sendVideo(outsider.id, convo.id, { key })
      expect(res.statusCode).toBe(403)
    })

    it('sem autenticação → 401', async () => {
      const a = await makeUser()
      const b = await makeUser()
      const convo = await makeDirectConversation(a.id, b.id)
      const key = `conversations/${convo.id}/${randomUUID()}.mp4`
      const { body, contentType } = videoMultipart({ key })

      const res = await app.inject({
        method: 'POST',
        url: `/conversations/${convo.id}/messages/video`,
        headers: { 'content-type': contentType },
        payload: body,
      })
      expect(res.statusCode).toBe(401)
    })

    it('key vazia → 400', async () => {
      const a = await makeUser()
      const b = await makeUser()
      const convo = await makeDirectConversation(a.id, b.id)

      const res = await sendVideo(a.id, convo.id, { key: '' })
      expect(res.statusCode).toBe(400)
    })

    it('key só de espaços → 400 (trim no boundary)', async () => {
      const a = await makeUser()
      const b = await makeUser()
      const convo = await makeDirectConversation(a.id, b.id)

      const res = await sendVideo(a.id, convo.id, { key: '   ' })
      expect(res.statusCode).toBe(400)
    })

    it('mensagem só de vídeo não pode ser editada → 403', async () => {
      const a = await makeUser()
      const b = await makeUser()
      const convo = await makeDirectConversation(a.id, b.id)
      const key = `conversations/${convo.id}/${randomUUID()}.mp4`

      const created = await sendVideo(a.id, convo.id, { key })
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
  it('POST /delivered publica evento delivered com userIds e at', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    await makeMessage(convo.id, a.id, { content: 'oi' })

    const frame = await waitForChatEvent(
      (f) =>
        f.type === 'delivered' &&
        f.conversationId === convo.id &&
        (f.userIds ?? []).includes(b.id),
      async () => {
        await app.inject({
          method: 'POST',
          url: `/conversations/${convo.id}/delivered`,
          headers: auth(b.id),
        })
      },
    )

    expect(typeof frame.at).toBe('string')
    expect(frame.userIds).toEqual([b.id])
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

describe('markDeliveredBatchIfBehind (entrega monotônica em lote)', () => {
  it('avança quem está atrás de upTo e não regride quem já cobre', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const c = await makeUser()
    const convo = await makeGroupConversation(a.id, [b.id, c.id])
    const past = new Date(Date.now() - 60_000)
    const future = new Date(Date.now() + 60_000)

    // B e C nunca receberam → ambos atrás de `past` → 1 UPDATE avança os dois
    const first = await markDeliveredBatchIfBehind(convo.id, [b.id, c.id], past)
    expect(first?.at).toBeInstanceOf(Date)
    expect(first?.userIds.sort()).toEqual([b.id, c.id].sort())

    // Mesmo `upTo` já coberto → null (não regride nem duplica frame)
    const again = await markDeliveredBatchIfBehind(convo.id, [b.id, c.id], past)
    expect(again).toBeNull()

    // Mensagem mais nova ainda não coberta → avança de novo
    const advanced = await markDeliveredBatchIfBehind(
      convo.id,
      [b.id, c.id],
      future,
    )
    expect(advanced?.userIds).toHaveLength(2)

    // O watermark gravado COBRE upTo mesmo com upTo à frente do relógio da
    // app (skew app×banco): repetir o mesmo lote não gera evento duplicado.
    expect(advanced?.at.getTime()).toBeGreaterThanOrEqual(future.getTime())
    const repeat = await markDeliveredBatchIfBehind(
      convo.id,
      [b.id, c.id],
      future,
    )
    expect(repeat).toBeNull()
  })

  it('lotes concorrentes sobrepostos não deadlockam nem avançam duplicado', async () => {
    // Duas mensagens quase simultâneas na mesma conversa disparam dois batches
    // sobre conjuntos sobrepostos de linhas. Sem ordem determinística de lock
    // isso pode deadlockar (40P01) — o plano muda de Index Scan para Bitmap
    // Heap Scan conforme o tamanho do IN, e as ordens divergem. Com a ordem
    // imposta, um lote serializa atrás do outro e o usuário compartilhado
    // avança em EXATAMENTE um deles (sem frame duplicado no app).
    for (let round = 0; round < 3; round++) {
      const a = await makeUser()
      const b = await makeUser()
      const shared = await makeUser()
      const d = await makeUser()
      const convo = await makeGroupConversation(a.id, [b.id, shared.id, d.id])
      const upTo = new Date(Date.now() - 60_000)

      const [r1, r2] = await Promise.all([
        markDeliveredBatchIfBehind(convo.id, [b.id, shared.id], upTo),
        markDeliveredBatchIfBehind(convo.id, [shared.id, d.id], upTo),
      ])

      const all = [...(r1?.userIds ?? []), ...(r2?.userIds ?? [])]
      expect(all.sort()).toEqual([b.id, d.id, shared.id].sort())
      expect(all.filter((id) => id === shared.id)).toHaveLength(1)
    }
  })

  it('mensagem mais antiga que o watermark não gera novo avanço (upTo distintos)', async () => {
    // Duas instâncias processando mensagens DIFERENTES da mesma conversa: a
    // primeira avança o watermark além do createdAt da segunda; o segundo
    // batch então não retorna o usuário (nenhum evento delivered duplicado).
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    const t1 = new Date(Date.now() - 60_000)
    const t2 = new Date(Date.now() - 30_000)

    const first = await markDeliveredBatchIfBehind(convo.id, [b.id], t1)
    expect(first?.userIds).toEqual([b.id])

    const second = await markDeliveredBatchIfBehind(convo.id, [b.id], t2)
    expect(second).toBeNull()
  })

  it('retorna só quem realmente avançou (quem já cobria fica de fora)', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const c = await makeUser()
    const convo = await makeGroupConversation(a.id, [b.id, c.id])
    const upTo = new Date(Date.now() - 60_000)

    // C já recebeu além de upTo; só B deve avançar no lote.
    await markDeliveredBatchIfBehind(convo.id, [c.id], new Date())
    const res = await markDeliveredBatchIfBehind(convo.id, [b.id, c.id], upTo)
    expect(res?.userIds).toEqual([b.id])
  })

  it('não avança participante que saiu da conversa (leftAt)', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const c = await makeUser()
    const convo = await makeGroupConversation(a.id, [b.id, c.id])
    await testPrisma.conversationParticipant.updateMany({
      where: { conversationId: convo.id, userId: c.id },
      data: { leftAt: new Date() },
    })

    const res = await markDeliveredBatchIfBehind(
      convo.id,
      [b.id, c.id],
      new Date(Date.now() - 60_000),
    )
    expect(res?.userIds).toEqual([b.id])
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

  it('passar o bastão de admin gera mensagem SYSTEM', async () => {
    const owner = await makeUser()
    const member = await makeUser()
    const group = await makeGroupConversation(owner.id, [member.id])

    await app.inject({
      method: 'POST',
      url: `/conversations/${group.id}/leave`,
      headers: auth(owner.id),
    })

    const history = await app.inject({
      method: 'GET',
      url: `/conversations/${group.id}/messages`,
      headers: auth(member.id),
    })
    const sys = history
      .json()
      .data.filter((m: { type: string }) => m.type === 'SYSTEM')
      .map((m: { content: string }) => m.content)
    expect(sys).toEqual(
      expect.arrayContaining([
        expect.stringContaining('saiu do grupo'),
        expect.stringContaining('agora é admin do grupo'),
      ]),
    )
  })

  it('sair sendo o último participante não anuncia bastão nenhum', async () => {
    const owner = await makeUser()
    const group = await makeGroupConversation(owner.id, [])

    const left = await app.inject({
      method: 'POST',
      url: `/conversations/${group.id}/leave`,
      headers: auth(owner.id),
    })
    expect(left.statusCode).toBe(204)

    // Ninguém sobrou pra ler pela API — a contagem basta: se o grupo vazio
    // tivesse promovido alguém, seriam duas mensagens em vez da saída sozinha.
    const sistema = await testPrisma.message.count({
      where: { conversationId: group.id, type: 'SYSTEM' },
    })
    expect(sistema).toBe(1)
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

describe('typing respeita bloqueio (findTypingRecipientUserIds)', () => {
  it('exclui quem bloqueou o remetente do fan-out de typing', async () => {
    const sender = await makeUser()
    const memberA = await makeUser()
    const blocker = await makeUser()
    const convo = await makeGroupConversation(sender.id, [
      memberA.id,
      blocker.id,
    ])

    await makeBlock(blocker.id, sender.id)

    const recipients = await findTypingRecipientUserIds(convo.id, sender.id)

    expect(recipients).toContain(sender.id) // remetente sempre presente (anti-spoof guard)
    expect(recipients).toContain(memberA.id)
    expect(recipients).not.toContain(blocker.id)
  })

  it('exclui quem o remetente bloqueou do fan-out de typing', async () => {
    const sender = await makeUser()
    const memberA = await makeUser()
    const blockedBySender = await makeUser()
    const convo = await makeGroupConversation(sender.id, [
      memberA.id,
      blockedBySender.id,
    ])

    await makeBlock(sender.id, blockedBySender.id)

    const recipients = await findTypingRecipientUserIds(convo.id, sender.id)

    expect(recipients).toContain(sender.id)
    expect(recipients).toContain(memberA.id)
    expect(recipients).not.toContain(blockedBySender.id)
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
    // 1.1: mídia de chat é privada — o destroy usa 'authenticated'; destroy no
    // namespace público não apagaria o asset → órfão pago.
    expect(fakeStorage.deletedResources).toContainEqual({
      key,
      deliveryType: 'authenticated',
    })
  })

  it('apagar mensagem de imagem remove o arquivo', async () => {
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
      deliveryType: 'authenticated',
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

  it('vídeo: retry com a mesma key não duplica (e não deleta o vídeo)', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    const key = `conversations/${convo.id}/${randomUUID()}.mp4`

    const send = () => {
      const { body, contentType } = videoMultipart({ key })
      return app.inject({
        method: 'POST',
        url: `/conversations/${convo.id}/messages/video`,
        headers: { ...idem(a.id, 'vid-1'), 'content-type': contentType },
        payload: body,
      })
    }

    const first = await send()
    const second = await send()

    expect(first.statusCode).toBe(201)
    expect(second.json().id).toBe(first.json().id)
    const count = await testPrisma.message.count({
      where: { conversationId: convo.id },
    })
    expect(count).toBe(1)
    // O retry usa a MESMA key da assinatura original: a corrida de idempotência
    // não pode deletar o vídeo da mensagem vencedora.
    expect(fakeStorage.deleted).not.toContain(key)
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

  it('assinatura de vídeo trava a key na pasta da conversa (sempre privada)', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)

    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages/video/signature`,
      headers: auth(a.id),
      body: { mimetype: 'video/mp4' },
    })
    expect(res.statusCode).toBe(200)
    // signUpload não recebe deliveryType: o driver real (R2StorageService)
    // sempre assina o PUT contra o bucket privado — não há alternativa pública.
    expect(res.json().key.startsWith(`conversations/${convo.id}/`)).toBe(true)
    expect(res.json().uploadUrl).toBeTruthy()
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

  it('vídeo: atinge a cota → 413 e remove o vídeo E o poster órfãos do provider', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const convo = await makeDirectConversation(a.id, b.id)
    await seedMedia(convo.id, a.id, env.CHAT_USER_STORAGE_QUOTA_BYTES)
    const key = `conversations/${convo.id}/${randomUUID()}.mp4`
    const deletedBefore = fakeStorage.deleted.length
    const { body, contentType } = videoMultipart(
      { key },
      {
        buffer: await tinyPngBuffer(),
        filename: 'poster.png',
        mimetype: 'image/png',
      },
    )

    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${convo.id}/messages/video`,
      headers: { ...auth(a.id), 'content-type': contentType },
      payload: body,
    })

    expect(res.statusCode).toBe(413)
    // O vídeo (subido pelo cliente) e o poster (subido pelo backend) viraram
    // órfãos (recusamos a mensagem) → ambos removidos.
    expect(fakeStorage.deleted).toContain(key)
    expect(fakeStorage.deleted.length).toBeGreaterThan(deletedBefore + 1)
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

describe('índices das tabelas de chat', () => {
  // FK sem índice que a lidere faz o Postgres varrer a tabela INTEIRA a cada
  // linha referenciada que é apagada (cascade/set null). Nas tabelas de chat,
  // que crescem sem teto, isso trava o banco ao apagar conta ou conversa.
  // Auditamos as duas direções: FKs DAS tabelas de chat e FKs de qualquer
  // tabela APONTANDO para elas — o cascade de messages dispara o fixup na
  // tabela dona da FK externa (ex.: reports.messageId), não na de chat.
  it('toda FK de coluna única tem índice que a lidera', async () => {
    const tables = [
      'conversations',
      'conversation_participants',
      'messages',
      'message_reactions',
      'message_attachments',
    ]

    const unindexed = await testPrisma.$queryRaw<
      { tbl: string; col: string }[]
    >(
      Prisma.sql`
        SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
        FROM pg_constraint c
        JOIN pg_attribute a
          ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f'
          AND array_length(c.conkey, 1) = 1
          AND (
            c.conrelid::regclass::text IN (${Prisma.join(tables)})
            OR c.confrelid::regclass::text IN (${Prisma.join(tables)})
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_index i
            WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1]
          )
        ORDER BY tbl, col
      `,
    )

    expect(unindexed).toEqual([])
  })
})

describe('visibilidade de contas inativas no chat', () => {
  it('não permite iniciar DM com usuário inativo (404)', async () => {
    const viewer = await makeUser()
    const target = await makeUser({ accountStatus: 'DEACTIVATED' })

    const res = await app.inject({
      method: 'POST',
      url: '/conversations',
      headers: auth(viewer.id),
      body: { type: 'DIRECT', targetUserId: target.id },
    })

    expect(res.statusCode).toBe(404)
  })
})
