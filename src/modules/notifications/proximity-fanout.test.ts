import type { EventCategory } from '@prisma/client'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { realtime } from '../../lib/realtime'
import { makeEvent, makeUser } from '../../test/factories'
import { fakePush } from '../../test/fake-push'
import { testPrisma } from '../../test/prisma'
import {
  reconcilePushReceipts,
  sendPushToUsers,
} from './notification-push.service'
import { runEventCreatedFanout } from './proximity-fanout.service'

const GEOHASH = '6gkzwg'
const LAT = -25.38116
const LNG = -49.26819
const CATEGORY: EventCategory = 'MUSIC'
const TOKEN = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]'

beforeEach(() => {
  // Foreground best-effort: isola do Redis.
  vi.spyOn(realtime, 'publishNotification').mockResolvedValue(undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
  fakePush.reset()
})
afterAll(async () => {
  await testPrisma.$disconnect()
})

async function makeNearbyUser(withToken = true) {
  const user = await makeUser()
  await testPrisma.user.update({
    where: { id: user.id },
    data: {
      locationGeohash: GEOHASH,
      locationUpdatedAt: new Date(),
      notifyRadiusKm: 10,
    },
  })
  await testPrisma.userConsent.create({
    data: { userId: user.id, locationPrecise: true, pushNotifications: true },
  })
  await testPrisma.userCategoryPreference.create({
    data: { userId: user.id, category: CATEGORY },
  })
  if (withToken) {
    await testPrisma.deviceToken.create({
      data: { userId: user.id, token: TOKEN },
    })
  }
  return user
}

function makeNearbyEvent(authorId: string, overrides = {}) {
  return makeEvent(authorId, {
    isPublic: true,
    category: CATEGORY,
    latitude: LAT,
    longitude: LNG,
    ...overrides,
  })
}

describe('sendPushToUsers', () => {
  it('envia push aos tokens ativos e persiste tickets PENDING', async () => {
    const user = await makeNearbyUser()
    const { sent } = await sendPushToUsers([user.id], {
      title: 'Oi',
      body: 'corpo',
    })

    expect(sent).toBe(1)
    expect(fakePush.sent).toHaveLength(1)
    expect(fakePush.sent[0].to).toBe(TOKEN)
    const tickets = await testPrisma.pushTicket.findMany()
    expect(tickets).toHaveLength(1)
    expect(tickets[0].status).toBe('PENDING')
    expect(tickets[0].receiptId).not.toBeNull()
  })

  it('DeviceNotRegistered no ticket invalida o DeviceToken na hora', async () => {
    const user = await makeNearbyUser()
    fakePush.ticketFor = (m) => ({
      status: 'error',
      token: m.to,
      error: 'DeviceNotRegistered',
    })

    await sendPushToUsers([user.id], { title: 'x', body: 'y' })

    const device = await testPrisma.deviceToken.findUnique({
      where: { token: TOKEN },
    })
    expect(device?.invalidatedAt).not.toBeNull()
  })

  it('sem token ativo, não envia', async () => {
    const user = await makeNearbyUser(false)
    const { sent } = await sendPushToUsers([user.id], { title: 'x', body: 'y' })
    expect(sent).toBe(0)
    expect(fakePush.sent).toHaveLength(0)
  })
})

describe('reconcilePushReceipts', () => {
  it('receipt OK fecha o ticket; DeviceNotRegistered invalida o token', async () => {
    await makeNearbyUser()
    const device = await testPrisma.deviceToken.findUnique({
      where: { token: TOKEN },
    })
    const past = new Date(Date.now() - 60_000) // maduro p/ o cutoff (sem clock-skew)
    const okTicket = await testPrisma.pushTicket.create({
      data: {
        deviceTokenId: device?.id ?? '',
        receiptId: 'r-ok',
        createdAt: past,
      },
    })
    const errTicket = await testPrisma.pushTicket.create({
      data: {
        deviceTokenId: device?.id ?? '',
        receiptId: 'r-err',
        createdAt: past,
      },
    })
    fakePush.receipts.set('r-ok', { status: 'ok' })
    fakePush.receipts.set('r-err', {
      status: 'error',
      error: 'DeviceNotRegistered',
    })

    const result = await reconcilePushReceipts({ delayMs: 0, limit: 100 })

    expect(result.checked).toBe(2)
    expect(result.invalidated).toBe(1)
    expect(
      (await testPrisma.pushTicket.findUnique({ where: { id: okTicket.id } }))
        ?.status,
    ).toBe('OK')
    expect(
      (await testPrisma.pushTicket.findUnique({ where: { id: errTicket.id } }))
        ?.status,
    ).toBe('ERROR')
    expect(
      (await testPrisma.deviceToken.findUnique({ where: { token: TOKEN } }))
        ?.invalidatedAt,
    ).not.toBeNull()
  })
})

describe('runEventCreatedFanout', () => {
  it('cria EVENT_NEARBY e envia push para os usuários próximos', async () => {
    const author = await makeUser()
    const user = await makeNearbyUser()
    const event = await makeNearbyEvent(author.id)

    const { notified } = await runEventCreatedFanout(event.id)

    expect(notified).toBe(1)
    const n = await testPrisma.notification.findFirst({
      where: { userId: user.id, type: 'EVENT_NEARBY', eventId: event.id },
    })
    expect(n).not.toBeNull()
    const pushed = fakePush.sent.find((m) => m.to === TOKEN)
    expect(pushed).toBeDefined()
    // Contrato do deep-link: o data do push carrega notificationId/type/ids.
    expect(pushed?.data).toMatchObject({
      notificationId: n?.id,
      type: 'EVENT_NEARBY',
      eventId: event.id,
    })
  })

  it('é idempotente: re-run não duplica notificação nem re-empurra', async () => {
    const author = await makeUser()
    await makeNearbyUser()
    const event = await makeNearbyEvent(author.id)

    await runEventCreatedFanout(event.id)
    fakePush.reset()
    const second = await runEventCreatedFanout(event.id)

    expect(second.notified).toBe(0)
    expect(fakePush.sent).toHaveLength(0)
    const count = await testPrisma.notification.count({
      where: { type: 'EVENT_NEARBY', eventId: event.id },
    })
    expect(count).toBe(1)
  })

  it('evento privado não dispara fan-out', async () => {
    const author = await makeUser()
    await makeNearbyUser()
    const event = await makeNearbyEvent(author.id, { isPublic: false })

    const { notified } = await runEventCreatedFanout(event.id)
    expect(notified).toBe(0)
    expect(
      await testPrisma.notification.count({ where: { type: 'EVENT_NEARBY' } }),
    ).toBe(0)
  })
})
