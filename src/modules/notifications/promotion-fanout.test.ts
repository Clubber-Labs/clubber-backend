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
import {
  makeAttendance,
  makeBlock,
  makeEvent,
  makeUser,
} from '../../test/factories'
import { fakePush } from '../../test/fake-push'
import { testPrisma } from '../../test/prisma'
import {
  promotionWaveDedupeKey,
  runPromotionReachFanout,
} from './promotion-fanout.service'
import { runEventCreatedFanout } from './proximity-fanout.service'

const GEOHASH = '6gkzwg'
const LAT = -25.38116
const LNG = -49.26819
const CATEGORY: EventCategory = 'MUSIC'
const OTHER_CATEGORY: EventCategory = 'TECH'
const TOKEN = 'ExponentPushToken[cccccccccccccccccccccc]'

const DAY = 86_400_000

beforeEach(() => {
  vi.spyOn(realtime, 'publishNotification').mockResolvedValue(undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
  fakePush.reset()
})
afterAll(async () => {
  await testPrisma.$disconnect()
})

async function makeNearbyUser(
  opts: { preference?: EventCategory | null; push?: boolean } = {},
) {
  const user = await makeUser()
  await testPrisma.user.update({
    where: { id: user.id },
    data: {
      locationGeohash: GEOHASH,
      locationUpdatedAt: new Date(),
      notifyRadiusKm: 10,
      lastSeenAt: new Date(),
    },
  })
  await testPrisma.userConsent.update({
    where: { userId: user.id },
    data: { locationPrecise: true, pushNotifications: opts.push ?? true },
  })
  const preference = opts.preference === undefined ? CATEGORY : opts.preference
  if (preference) {
    await testPrisma.userCategoryPreference.create({
      data: { userId: user.id, category: preference },
    })
  }
  await testPrisma.deviceToken.create({
    data: { userId: user.id, token: `${TOKEN}${user.id.slice(0, 4)}` },
  })
  return user
}

function makePromotedEvent(
  authorId: string,
  overrides: Record<string, unknown> = {},
) {
  return makeEvent(authorId, {
    isPublic: true,
    isFeatured: true,
    category: CATEGORY,
    latitude: LAT,
    longitude: LNG,
    date: new Date(Date.now() + DAY),
    ...overrides,
  })
}

function notificationsFor(userId: string, eventId: string) {
  return testPrisma.notification.findMany({
    where: { userId, eventId },
    orderBy: { createdAt: 'asc' },
  })
}

describe('runPromotionReachFanout', () => {
  it('alcança quem já recebeu a notificação de criação do evento', async () => {
    const author = await makeUser({ isPremium: true })
    const user = await makeNearbyUser()
    const event = await makePromotedEvent(author.id)

    await runEventCreatedFanout(event.id)
    const afterCreation = await notificationsFor(user.id, event.id)
    expect(afterCreation).toHaveLength(1)

    const result = await runPromotionReachFanout(event.id)

    expect(result.notified).toBe(1)
    const all = await notificationsFor(user.id, event.id)
    expect(all).toHaveLength(2)
    expect(all[1].dedupeKey).toBe(promotionWaveDedupeKey(event.id, 1))
    expect(all[1].params).toMatchObject({ promoted: true })
  })

  it('alcança quem NÃO tem a categoria nas preferências', async () => {
    const author = await makeUser({ isPremium: true })
    const user = await makeNearbyUser({ preference: OTHER_CATEGORY })
    const event = await makePromotedEvent(author.id)

    await runEventCreatedFanout(event.id)
    expect(await notificationsFor(user.id, event.id)).toHaveLength(0)

    const result = await runPromotionReachFanout(event.id)

    expect(result.notified).toBe(1)
    const all = await notificationsFor(user.id, event.id)
    expect(all).toHaveLength(1)
    expect(all[0].dedupeKey).toBe(promotionWaveDedupeKey(event.id, 1))
  })

  it('envia push com a copy de destaque', async () => {
    const author = await makeUser({ isPremium: true })
    await makeNearbyUser()
    const event = await makePromotedEvent(author.id, { title: 'Rave na Ilha' })

    await runPromotionReachFanout(event.id)

    expect(fakePush.sent).toHaveLength(1)
    expect(fakePush.sent[0].title).toBe('Em destaque perto de você')
    expect(fakePush.sent[0].body).toBe('Rave na Ilha')
  })

  it('entrega in-app mesmo sem consentimento de push', async () => {
    const author = await makeUser({ isPremium: true })
    const user = await makeNearbyUser({ push: false })
    const event = await makePromotedEvent(author.id)

    const result = await runPromotionReachFanout(event.id)

    expect(result.notified).toBe(1)
    expect(await notificationsFor(user.id, event.id)).toHaveLength(1)
    expect(fakePush.sent).toHaveLength(0)
  })

  it('é idempotente entre execuções', async () => {
    const author = await makeUser({ isPremium: true })
    const user = await makeNearbyUser()
    const event = await makePromotedEvent(author.id)

    await runPromotionReachFanout(event.id)
    const second = await runPromotionReachFanout(event.id)

    expect(second.notified).toBe(0)
    expect(await notificationsFor(user.id, event.id)).toHaveLength(1)
  })

  it('não alcança o autor, quem já tem presença nem quem bloqueou', async () => {
    const author = await makeNearbyUser()
    await testPrisma.user.update({
      where: { id: author.id },
      data: { isPremium: true },
    })
    const attendee = await makeNearbyUser()
    const blocker = await makeNearbyUser()
    const event = await makePromotedEvent(author.id)
    await makeAttendance(attendee.id, event.id)
    await makeBlock(blocker.id, author.id)

    const result = await runPromotionReachFanout(event.id)

    expect(result.notified).toBe(0)
    expect(await notificationsFor(author.id, event.id)).toHaveLength(0)
    expect(await notificationsFor(attendee.id, event.id)).toHaveLength(0)
    expect(await notificationsFor(blocker.id, event.id)).toHaveLength(0)
  })

  it('não dispara para evento sem promoção ativa, privado, cancelado ou encerrado', async () => {
    const author = await makeUser({ isPremium: true })
    const user = await makeNearbyUser()

    const notPromoted = await makePromotedEvent(author.id, {
      isFeatured: false,
    })
    const private_ = await makePromotedEvent(author.id, { isPublic: false })
    const canceled = await makePromotedEvent(author.id, {
      canceledAt: new Date(),
    })
    const ended = await makePromotedEvent(author.id, {
      date: new Date(Date.now() - 2 * DAY),
      endDate: new Date(Date.now() - DAY),
    })

    for (const event of [notPromoted, private_, canceled, ended]) {
      expect((await runPromotionReachFanout(event.id)).notified).toBe(0)
      expect(await notificationsFor(user.id, event.id)).toHaveLength(0)
    }
  })
})
