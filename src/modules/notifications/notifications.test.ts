import type { FastifyInstance } from 'fastify'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { realtime } from '../../lib/realtime'
import { buildApp } from '../../test/app'
import { makeBlock, makeUser } from '../../test/factories'
import { testPrisma } from '../../test/prisma'
import { anonymizeUserTx } from '../users/users.repository'
import { reconcileNotificationRetention } from './notification-retention.reconciler'
import { dispatchSocial } from './notifications.service'

let app: FastifyInstance

function token(userId: string) {
  return app.jwt.sign({ sub: userId })
}

const VALID_EXPO_TOKEN = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]'

let dedupeCounter = 0
async function makeNotification(
  userId: string,
  overrides: {
    type?: 'EVENT_NEARBY' | 'EVENT_COMMENT' | 'FOLLOW_ACCEPTED' | 'NEW_FOLLOWER'
    title?: string
    body?: string
    dedupeKey?: string
    createdAt?: Date
    readAt?: Date | null
    actorId?: string
  } = {},
) {
  return testPrisma.notification.create({
    data: {
      userId,
      type: overrides.type ?? 'EVENT_COMMENT',
      title: overrides.title ?? 'Título',
      body: overrides.body ?? 'Corpo',
      dedupeKey: overrides.dedupeKey ?? `key-${++dedupeCounter}`,
      actorId: overrides.actorId,
      ...(overrides.createdAt && { createdAt: overrides.createdAt }),
      ...(overrides.readAt !== undefined && { readAt: overrides.readAt }),
    },
  })
}

beforeAll(async () => {
  app = buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await testPrisma.$disconnect()
})

// publishNotification é best-effort; mockamos pra isolar do Redis e contar chamadas.
let publishSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  publishSpy = vi
    .spyOn(realtime, 'publishNotification')
    .mockResolvedValue(undefined)
})
afterEach(() => {
  publishSpy.mockRestore()
})

describe('dispatchSocial', () => {
  it('cria a notificação in-app e entrega em foreground', async () => {
    const [recipient, actor] = await Promise.all([makeUser(), makeUser()])

    await dispatchSocial({
      recipientId: recipient.id,
      actorId: actor.id,
      type: 'EVENT_COMMENT',
      title: 'Novo comentário',
      body: 'Fulano comentou no seu evento',
      eventId: 'evt-1',
      commentId: 'cmt-1',
    })

    const notifications = await testPrisma.notification.findMany({
      where: { userId: recipient.id },
    })
    expect(notifications).toHaveLength(1)
    expect(notifications[0]).toMatchObject({
      type: 'EVENT_COMMENT',
      actorId: actor.id,
      eventId: 'evt-1',
    })
    expect(publishSpy).toHaveBeenCalledTimes(1)
    expect(publishSpy.mock.calls[0][0]).toMatchObject({
      type: 'notification',
      recipientId: recipient.id,
    })
  })

  it('não notifica a si mesmo (autor == destinatário)', async () => {
    const user = await makeUser()

    await dispatchSocial({
      recipientId: user.id,
      actorId: user.id,
      type: 'EVENT_REACTION',
      title: 'x',
      body: 'y',
    })

    const count = await testPrisma.notification.count({
      where: { userId: user.id },
    })
    expect(count).toBe(0)
    expect(publishSpy).not.toHaveBeenCalled()
  })

  it('não notifica quando há bloqueio entre as partes', async () => {
    const [recipient, actor] = await Promise.all([makeUser(), makeUser()])
    await makeBlock(recipient.id, actor.id)

    await dispatchSocial({
      recipientId: recipient.id,
      actorId: actor.id,
      type: 'EVENT_COMMENT',
      title: 'x',
      body: 'y',
    })

    const count = await testPrisma.notification.count({
      where: { userId: recipient.id },
    })
    expect(count).toBe(0)
    expect(publishSpy).not.toHaveBeenCalled()
  })

  it('é idempotente: gatilho repetido não duplica nem re-entrega', async () => {
    const [recipient, actor] = await Promise.all([makeUser(), makeUser()])
    const input = {
      recipientId: recipient.id,
      actorId: actor.id,
      type: 'EVENT_COMMENT' as const,
      title: 'Novo comentário',
      body: 'corpo',
      eventId: 'evt-1',
      commentId: 'cmt-1',
    }

    await dispatchSocial(input)
    await dispatchSocial(input)

    const count = await testPrisma.notification.count({
      where: { userId: recipient.id },
    })
    expect(count).toBe(1)
    expect(publishSpy).toHaveBeenCalledTimes(1)
  })
})

describe('GET /notifications', () => {
  it('retorna 401 sem autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: '/notifications' })
    expect(res.statusCode).toBe(401)
  })

  it('lista as notificações do usuário, mais recentes primeiro', async () => {
    const user = await makeUser()
    await makeNotification(user.id, {
      title: 'antiga',
      createdAt: new Date(Date.now() - 10_000),
    })
    await makeNotification(user.id, { title: 'nova' })
    // Notificação de outro usuário não deve aparecer.
    const other = await makeUser()
    await makeNotification(other.id, { title: 'alheia' })

    const res = await app.inject({
      method: 'GET',
      url: '/notifications',
      headers: { authorization: `Bearer ${token(user.id)}` },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toHaveLength(2)
    expect(body.data[0].title).toBe('nova')
    expect(body.data[1].title).toBe('antiga')
  })

  it('pagina por cursor estável', async () => {
    const user = await makeUser()
    for (let i = 0; i < 3; i++) {
      await makeNotification(user.id, {
        title: `n${i}`,
        createdAt: new Date(Date.now() - i * 1000),
      })
    }

    const first = await app.inject({
      method: 'GET',
      url: '/notifications?limit=2',
      headers: { authorization: `Bearer ${token(user.id)}` },
    })
    const firstBody = first.json()
    expect(firstBody.data).toHaveLength(2)
    expect(firstBody.nextCursor).toBeTruthy()

    const second = await app.inject({
      method: 'GET',
      url: `/notifications?limit=2&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
      headers: { authorization: `Bearer ${token(user.id)}` },
    })
    const secondBody = second.json()
    expect(secondBody.data).toHaveLength(1)
    expect(secondBody.nextCursor).toBeNull()
  })
})

describe('unread-count e read', () => {
  it('conta não lidas e zera ao marcar tudo como lido', async () => {
    const user = await makeUser()
    await makeNotification(user.id)
    await makeNotification(user.id)
    const auth = { authorization: `Bearer ${token(user.id)}` }

    const before = await app.inject({
      method: 'GET',
      url: '/notifications/unread-count',
      headers: auth,
    })
    expect(before.json().count).toBe(2)

    const readAll = await app.inject({
      method: 'POST',
      url: '/notifications/read-all',
      headers: auth,
    })
    expect(readAll.json().updated).toBe(2)

    const after = await app.inject({
      method: 'GET',
      url: '/notifications/unread-count',
      headers: auth,
    })
    expect(after.json().count).toBe(0)
  })

  it('marca uma notificação como lida (204) e é idempotente', async () => {
    const user = await makeUser()
    const notification = await makeNotification(user.id)
    const auth = { authorization: `Bearer ${token(user.id)}` }

    const res = await app.inject({
      method: 'PATCH',
      url: `/notifications/${notification.id}/read`,
      headers: auth,
    })
    expect(res.statusCode).toBe(204)

    const fresh = await testPrisma.notification.findUnique({
      where: { id: notification.id },
    })
    expect(fresh?.readAt).not.toBeNull()

    // Idempotente: marcar de novo continua 204.
    const again = await app.inject({
      method: 'PATCH',
      url: `/notifications/${notification.id}/read`,
      headers: auth,
    })
    expect(again.statusCode).toBe(204)
  })

  it('retorna 404 ao marcar notificação de outro usuário', async () => {
    const [owner, intruder] = await Promise.all([makeUser(), makeUser()])
    const notification = await makeNotification(owner.id)

    const res = await app.inject({
      method: 'PATCH',
      url: `/notifications/${notification.id}/read`,
      headers: { authorization: `Bearer ${token(intruder.id)}` },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('device tokens', () => {
  it('retorna 401 sem autenticação', async () => {
    const post = await app.inject({
      method: 'POST',
      url: '/devices',
      body: { token: VALID_EXPO_TOKEN },
    })
    expect(post.statusCode).toBe(401)
    const del = await app.inject({
      method: 'DELETE',
      url: `/devices/${encodeURIComponent(VALID_EXPO_TOKEN)}`,
    })
    expect(del.statusCode).toBe(401)
  })

  it('registra um token Expo válido (201)', async () => {
    const user = await makeUser()
    const res = await app.inject({
      method: 'POST',
      url: '/devices',
      headers: { authorization: `Bearer ${token(user.id)}` },
      body: { token: VALID_EXPO_TOKEN, platform: 'ios' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().token).toBe(VALID_EXPO_TOKEN)

    const stored = await testPrisma.deviceToken.findUnique({
      where: { token: VALID_EXPO_TOKEN },
    })
    expect(stored?.userId).toBe(user.id)
  })

  it('rejeita token com formato inválido (400)', async () => {
    const user = await makeUser()
    const res = await app.inject({
      method: 'POST',
      url: '/devices',
      headers: { authorization: `Bearer ${token(user.id)}` },
      body: { token: 'token-qualquer' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('re-registro do mesmo token migra o dono e reativa', async () => {
    const [first, second] = await Promise.all([makeUser(), makeUser()])
    await app.inject({
      method: 'POST',
      url: '/devices',
      headers: { authorization: `Bearer ${token(first.id)}` },
      body: { token: VALID_EXPO_TOKEN },
    })
    await app.inject({
      method: 'POST',
      url: '/devices',
      headers: { authorization: `Bearer ${token(second.id)}` },
      body: { token: VALID_EXPO_TOKEN },
    })

    const tokens = await testPrisma.deviceToken.findMany({
      where: { token: VALID_EXPO_TOKEN },
    })
    expect(tokens).toHaveLength(1)
    expect(tokens[0].userId).toBe(second.id)
  })

  it('remove o token do device (204)', async () => {
    const user = await makeUser()
    await testPrisma.deviceToken.create({
      data: { userId: user.id, token: VALID_EXPO_TOKEN },
    })

    const res = await app.inject({
      method: 'DELETE',
      url: `/devices/${encodeURIComponent(VALID_EXPO_TOKEN)}`,
      headers: { authorization: `Bearer ${token(user.id)}` },
    })
    expect(res.statusCode).toBe(204)
    const remaining = await testPrisma.deviceToken.count({
      where: { token: VALID_EXPO_TOKEN },
    })
    expect(remaining).toBe(0)
  })
})

describe('LGPD — anonimização', () => {
  it('apaga device tokens e notificações do usuário anonimizado', async () => {
    const user = await makeUser({
      accountStatus: 'PENDING_DELETION',
      scheduledDeletionAt: new Date(),
    })
    await makeNotification(user.id)
    await testPrisma.deviceToken.create({
      data: { userId: user.id, token: VALID_EXPO_TOKEN },
    })

    const anonymized = await anonymizeUserTx(user.id)
    expect(anonymized).toBe(true)

    const [notifications, tokens] = await Promise.all([
      testPrisma.notification.count({ where: { userId: user.id } }),
      testPrisma.deviceToken.count({ where: { userId: user.id } }),
    ])
    expect(notifications).toBe(0)
    expect(tokens).toBe(0)
  })
})

describe('retenção', () => {
  it('expurga notificações além do prazo e mantém as recentes', async () => {
    const user = await makeUser()
    const old = await makeNotification(user.id, {
      title: 'velha',
      createdAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
    })
    const recent = await makeNotification(user.id, { title: 'recente' })

    const { deleted } = await reconcileNotificationRetention(180)
    expect(deleted).toBeGreaterThanOrEqual(1)

    const remaining = await testPrisma.notification.findMany({
      where: { userId: user.id },
    })
    expect(remaining.map((n) => n.id)).toContain(recent.id)
    expect(remaining.map((n) => n.id)).not.toContain(old.id)
  })
})
