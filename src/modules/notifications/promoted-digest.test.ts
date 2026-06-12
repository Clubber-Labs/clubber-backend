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
import { runPromotedDigest } from './promoted-digest.reconciler'

const GEOHASH = '6gkzwg'
const LAT = -25.38116
const LNG = -49.26819
const CATEGORY: EventCategory = 'MUSIC'
const OTHER_CATEGORY: EventCategory = 'TECH'
const TOKEN = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]'

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

async function makeEligibleUser() {
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
  await testPrisma.userConsent.create({
    data: { userId: user.id, locationPrecise: true, pushNotifications: true },
  })
  await testPrisma.userCategoryPreference.create({
    data: { userId: user.id, category: CATEGORY },
  })
  await testPrisma.deviceToken.create({
    data: { userId: user.id, token: TOKEN },
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

function promotedNotifications(userId: string) {
  return testPrisma.notification.findMany({
    where: { userId, dedupeKey: { startsWith: 'EVENT_NEARBY:promoted:' } },
  })
}

describe('runPromotedDigest', () => {
  it('usuário elegível com promovido perto recebe 1 notificação curada', async () => {
    const user = await makeEligibleUser()
    const author = await makeUser({ isPremium: true })
    const event = await makePromotedEvent(author.id)

    const { notified } = await runPromotedDigest(new Date())

    expect(notified).toBe(1)
    const notifs = await promotedNotifications(user.id)
    expect(notifs).toHaveLength(1)
    expect(notifs[0].eventId).toBe(event.id)
    expect(notifs[0].type).toBe('EVENT_NEARBY')
    expect(notifs[0].dedupeKey).toBe(`EVENT_NEARBY:promoted:${event.id}`)
  })

  it('com N promovidos perto, recebe APENAS 1 (o mais relevante por categoria)', async () => {
    const user = await makeEligibleUser()
    const author = await makeUser({ isPremium: true })
    // Dois promovidos no raio: um casa a categoria preferida, outro não.
    await makePromotedEvent(author.id, { category: OTHER_CATEGORY })
    const matching = await makePromotedEvent(author.id, { category: CATEGORY })

    await runPromotedDigest(new Date())

    const notifs = await promotedNotifications(user.id)
    expect(notifs).toHaveLength(1)
    expect(notifs[0].eventId).toBe(matching.id)
  })

  it('usuário em cooldown não recebe', async () => {
    const user = await makeEligibleUser()
    const author = await makeUser({ isPremium: true })
    const previous = await makePromotedEvent(author.id)
    // Notificação de promoção recente (dentro do cooldown).
    await testPrisma.notification.create({
      data: {
        userId: user.id,
        type: 'EVENT_NEARBY',
        eventId: previous.id,
        title: 'x',
        body: 'x',
        dedupeKey: `EVENT_NEARBY:promoted:${previous.id}`,
      },
    })
    await makePromotedEvent(author.id)

    const { notified } = await runPromotedDigest(new Date())

    expect(notified).toBe(0)
    expect(await promotedNotifications(user.id)).toHaveLength(1)
  })

  it('2º tick no mesmo período não duplica (idempotente)', async () => {
    await makeEligibleUser()
    const author = await makeUser({ isPremium: true })
    await makePromotedEvent(author.id)

    const first = await runPromotedDigest(new Date())
    const second = await runPromotedDigest(new Date())

    expect(first.notified).toBe(1)
    expect(second.notified).toBe(0)
  })

  it('ignora usuário sem consentimento de push', async () => {
    const user = await makeEligibleUser()
    await testPrisma.userConsent.update({
      where: { userId: user.id },
      data: { pushNotifications: false },
    })
    const author = await makeUser({ isPremium: true })
    await makePromotedEvent(author.id)

    const { notified } = await runPromotedDigest(new Date())

    expect(notified).toBe(0)
  })

  it('ignora usuário inativo (lastSeenAt antigo)', async () => {
    const user = await makeEligibleUser()
    await testPrisma.user.update({
      where: { id: user.id },
      data: { lastSeenAt: new Date(Date.now() - 90 * DAY) },
    })
    const author = await makeUser({ isPremium: true })
    await makePromotedEvent(author.id)

    const { notified } = await runPromotedDigest(new Date())

    expect(notified).toBe(0)
  })

  it('não recomenda evento próprio nem evento que o usuário já confirmou', async () => {
    const user = await makeEligibleUser()
    // Promovido do PRÓPRIO usuário: não recomenda pra ele.
    await makePromotedEvent(user.id)
    // Promovido de outro autor, mas o usuário já confirmou presença.
    const author = await makeUser({ isPremium: true })
    const attended = await makePromotedEvent(author.id)
    await makeAttendance(user.id, attended.id, 'CONFIRMED')

    const { notified } = await runPromotedDigest(new Date())

    expect(notified).toBe(0)
  })

  it('sem promovido dentro do raio, não notifica', async () => {
    await makeEligibleUser()
    const author = await makeUser({ isPremium: true })
    // Promovido longe (~300km do geohash do usuário).
    await makePromotedEvent(author.id, { latitude: -23.5, longitude: -46.6 })

    const { notified } = await runPromotedDigest(new Date())

    expect(notified).toBe(0)
  })

  it('evento promovido cancelado ou privado não entra no digest', async () => {
    await makeEligibleUser()
    const author = await makeUser({ isPremium: true })
    await makePromotedEvent(author.id, { canceledAt: new Date() })
    await makePromotedEvent(author.id, { isPublic: false })

    const { notified } = await runPromotedDigest(new Date())

    expect(notified).toBe(0)
  })

  it('usuário que bloqueou o autor não recebe a notificação de promoção', async () => {
    const user = await makeEligibleUser()
    const author = await makeUser({ isPremium: true })
    await makeBlock(user.id, author.id)
    await makePromotedEvent(author.id)

    const { notified } = await runPromotedDigest(new Date())

    expect(notified).toBe(0)
  })

  it('usuário bloqueado pelo autor não recebe a notificação de promoção', async () => {
    const user = await makeEligibleUser()
    const author = await makeUser({ isPremium: true })
    await makeBlock(author.id, user.id)
    await makePromotedEvent(author.id)

    const { notified } = await runPromotedDigest(new Date())

    expect(notified).toBe(0)
  })
})
