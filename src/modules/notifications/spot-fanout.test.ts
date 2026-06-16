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
  makeBlock,
  makeFollow,
  makeSpot,
  makeSpotDiscoveryUsage,
  makeUser,
} from '../../test/factories'
import { fakePush } from '../../test/fake-push'
import { testPrisma } from '../../test/prisma'
import {
  runSpotJoinedFanout,
  runSpotPublishedFanout,
} from './spot-fanout.service'

const GEOHASH = '6gkzwg'
const LAT = -25.38116
const LNG = -49.26819
const CATEGORY: EventCategory = 'MUSIC'

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

/**
 * Usuário perto (geohash) com consentimento. `category` = preferência (default
 * casa o spot MUSIC); passe outra (ex.: SPORTS) para a audiência de descoberta.
 */
async function makeNearbyUser(category: EventCategory = CATEGORY) {
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
    data: { userId: user.id, category },
  })
  return user
}

function makeNearbySpot(creatorId: string, overrides = {}) {
  return makeSpot(creatorId, {
    categories: [CATEGORY],
    latitude: LAT,
    longitude: LNG,
    ...overrides,
  })
}

async function makeFriends(a: string, b: string) {
  await makeFollow(a, b, 'ACCEPTED')
  await makeFollow(b, a, 'ACCEPTED')
}

describe('runSpotPublishedFanout (SPOT_NEARBY)', () => {
  it('notifica quem está perto e prefere a categoria do spot', async () => {
    const creator = await makeUser()
    const user = await makeNearbyUser()
    const spot = await makeNearbySpot(creator.id)

    const { notified } = await runSpotPublishedFanout(spot.id)

    expect(notified).toBe(1)
    const n = await testPrisma.notification.findFirst({
      where: { userId: user.id, type: 'SPOT_NEARBY', spotId: spot.id },
    })
    expect(n).not.toBeNull()
  })

  it('categoria-pai cobre spot taguado (usuário prefere só a categoria)', async () => {
    const creator = await makeUser()
    // Prefere a categoria (MUSIC) mas não a subcategoria que o spot carrega: o
    // match hierárquico inclui pela categoria (catPref), mesmo com subPref vivo.
    const user = await makeNearbyUser('MUSIC')
    const spot = await makeNearbySpot(creator.id, {
      subcategories: ['GENRE_FUNK'],
    })

    const { notified } = await runSpotPublishedFanout(spot.id)

    expect(notified).toBe(1)
    const n = await testPrisma.notification.findFirst({
      where: { userId: user.id, type: 'SPOT_NEARBY', spotId: spot.id },
    })
    expect(n).not.toBeNull()
  })

  it('é idempotente: re-run não duplica', async () => {
    const creator = await makeUser()
    await makeNearbyUser()
    const spot = await makeNearbySpot(creator.id)

    await runSpotPublishedFanout(spot.id)
    const second = await runSpotPublishedFanout(spot.id)

    expect(second.notified).toBe(0)
    expect(
      await testPrisma.notification.count({
        where: { type: 'SPOT_NEARBY', spotId: spot.id },
      }),
    ).toBe(1)
  })

  it('spot FRIENDS só alcança follow mútuo do criador', async () => {
    const creator = await makeUser()
    const friend = await makeNearbyUser()
    const stranger = await makeNearbyUser()
    await makeFriends(creator.id, friend.id)
    const spot = await makeNearbySpot(creator.id, { visibility: 'FRIENDS' })

    const { notified } = await runSpotPublishedFanout(spot.id)

    expect(notified).toBe(1)
    expect(
      await testPrisma.notification.findFirst({
        where: { userId: friend.id, type: 'SPOT_NEARBY' },
      }),
    ).not.toBeNull()
    expect(
      await testPrisma.notification.findFirst({
        where: { userId: stranger.id, type: 'SPOT_NEARBY' },
      }),
    ).toBeNull()
  })

  it('bloqueio exclui o usuário do fan-out', async () => {
    const creator = await makeUser()
    const blocked = await makeNearbyUser()
    await makeBlock(creator.id, blocked.id)
    const spot = await makeNearbySpot(creator.id)

    const { notified } = await runSpotPublishedFanout(spot.id)
    expect(notified).toBe(0)
  })

  it('spot cancelado não dispara', async () => {
    const creator = await makeUser()
    await makeNearbyUser()
    const spot = await makeNearbySpot(creator.id, { canceledAt: new Date() })

    const { notified } = await runSpotPublishedFanout(spot.id)
    expect(notified).toBe(0)
  })

  it('spot já encerrado não dispara (job atrasado)', async () => {
    const creator = await makeUser()
    await makeNearbyUser()
    const past = Date.now() - 2 * 3600_000
    const spot = await makeNearbySpot(creator.id, {
      startsAt: new Date(past),
      endsAt: new Date(past + 3600_000),
    })

    const { notified } = await runSpotPublishedFanout(spot.id)
    expect(notified).toBe(0)
  })
})

describe('alcance premium (descoberta)', () => {
  it('criador premium alcança quem está perto FORA da preferência', async () => {
    const creator = await makeUser({ isPremium: true })
    const matched = await makeNearbyUser('MUSIC')
    const discovery = await makeNearbyUser('SPORTS') // perto, não prefere MUSIC
    const spot = await makeNearbySpot(creator.id) // categoria MUSIC

    const { notified } = await runSpotPublishedFanout(spot.id)

    expect(notified).toBe(2)
    for (const u of [matched, discovery]) {
      expect(
        await testPrisma.notification.findFirst({
          where: { userId: u.id, type: 'SPOT_NEARBY' },
        }),
      ).not.toBeNull()
    }
  })

  it('criador free NÃO alcança fora da preferência', async () => {
    const creator = await makeUser() // free
    const matched = await makeNearbyUser('MUSIC')
    const discovery = await makeNearbyUser('SPORTS')
    const spot = await makeNearbySpot(creator.id)

    const { notified } = await runSpotPublishedFanout(spot.id)

    expect(notified).toBe(1) // só quem prefere
    expect(
      await testPrisma.notification.findFirst({
        where: { userId: matched.id, type: 'SPOT_NEARBY' },
      }),
    ).not.toBeNull()
    expect(
      await testPrisma.notification.findFirst({
        where: { userId: discovery.id, type: 'SPOT_NEARBY' },
      }),
    ).toBeNull()
  })

  it('cap bloqueia SÓ a descoberta, não a audiência que prefere', async () => {
    const creator = await makeUser({ isPremium: true })
    const matched = await makeNearbyUser('MUSIC') // prefere → notificado
    const capped = await makeNearbyUser('SPORTS') // descoberta, no teto
    await makeSpotDiscoveryUsage(capped.id, 5) // cap = 5
    const spot = await makeNearbySpot(creator.id) // MUSIC

    const { notified } = await runSpotPublishedFanout(spot.id)

    expect(notified).toBe(1) // só a audiência que prefere
    expect(
      await testPrisma.notification.findFirst({
        where: { userId: matched.id, type: 'SPOT_NEARBY' },
      }),
    ).not.toBeNull()
    expect(
      await testPrisma.notification.findFirst({
        where: { userId: capped.id, type: 'SPOT_NEARBY' },
      }),
    ).toBeNull()
  })
})

describe('runSpotJoinedFanout (SPOT_JOIN)', () => {
  it('notifica criador + membros, exceto quem entrou', async () => {
    const creator = await makeUser()
    const member = await makeUser()
    const joiner = await makeUser()
    // Grupo já com membro e quem entrou; o fan-out notifica os outros.
    const spot = await makeSpot(creator.id, {
      memberIds: [member.id, joiner.id],
    })

    const { notified } = await runSpotJoinedFanout(spot.id, joiner.id)

    expect(notified).toBe(2) // criador + member
    for (const u of [creator, member]) {
      expect(
        await testPrisma.notification.findFirst({
          where: { userId: u.id, type: 'SPOT_JOIN', spotId: spot.id },
        }),
      ).not.toBeNull()
    }
    expect(
      await testPrisma.notification.findFirst({
        where: { userId: joiner.id, type: 'SPOT_JOIN' },
      }),
    ).toBeNull()
  })

  it('é idempotente por (spot, quem entrou)', async () => {
    const creator = await makeUser()
    const joiner = await makeUser()
    const spot = await makeSpot(creator.id, { memberIds: [joiner.id] })

    await runSpotJoinedFanout(spot.id, joiner.id)
    const second = await runSpotJoinedFanout(spot.id, joiner.id)

    expect(second.notified).toBe(0)
    expect(
      await testPrisma.notification.count({
        where: { type: 'SPOT_JOIN', spotId: spot.id },
      }),
    ).toBe(1) // só o criador
  })
})
