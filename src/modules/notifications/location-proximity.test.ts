import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { EventCategory } from '../../lib/event-categories'
import { buildApp } from '../../test/app'
import { makeBlock, makeUser } from '../../test/factories'
import { testPrisma } from '../../test/prisma'
import { revokeAllConsents, updateConsent } from '../consent/consent.service'
import { anonymizeUserTx } from '../users/users.repository'
import { reconcileLocationRetention } from './location-retention.reconciler'
import { findUsersToNotifyNearEvent } from './proximity.repository'

let app: FastifyInstance

function token(userId: string) {
  return app.jwt.sign({ sub: userId })
}

const EVENT = {
  longitude: -49.26819,
  latitude: -25.38116,
  category: 'MUSIC' as EventCategory,
}
const GEOHASH_NEAR = '6gkzwg' // mesmo ponto do evento (dist ~0)
const GEOHASH_MID = '6gkzwj' // ~3.5km do evento
const GEOHASH_FAR = '75cm8h' // ~671km (Rio)
const SCAN = { maxRadiusKm: 50, ttlDays: 90, limit: 100 }

type NotifiableOpts = {
  geohash?: string | null
  radiusKm?: number
  category?: EventCategory | null
  pushConsent?: boolean
  locationConsent?: boolean
  locationUpdatedAt?: Date
}

/** Cria um usuário com localização + consentimento + categoria configuráveis. */
async function makeNotifiableUser(opts: NotifiableOpts = {}) {
  const user = await makeUser()
  if (opts.geohash !== null) {
    await testPrisma.user.update({
      where: { id: user.id },
      data: {
        locationGeohash: opts.geohash ?? GEOHASH_NEAR,
        locationUpdatedAt: opts.locationUpdatedAt ?? new Date(),
        notifyRadiusKm: opts.radiusKm ?? 10,
      },
    })
  }
  await testPrisma.userConsent.create({
    data: {
      userId: user.id,
      locationPrecise: opts.locationConsent ?? true,
      pushNotifications: opts.pushConsent ?? true,
    },
  })
  if (opts.category !== null) {
    await testPrisma.userCategoryPreference.create({
      data: { userId: user.id, category: opts.category ?? EVENT.category },
    })
  }
  return user
}

async function scan(authorId: string) {
  return findUsersToNotifyNearEvent({ ...EVENT, authorId }, SCAN)
}

beforeAll(async () => {
  app = buildApp()
  await app.ready()
})
afterAll(async () => {
  await app.close()
  await testPrisma.$disconnect()
})

describe('PATCH /users/me/location', () => {
  it('retorna 401 sem autenticação', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/users/me/location',
      body: { geohash: GEOHASH_NEAR },
    })
    expect(res.statusCode).toBe(401)
  })

  it('retorna 403 sem consentimento de localização', async () => {
    const user = await makeUser()
    await testPrisma.userConsent.create({
      data: { userId: user.id, locationPrecise: false },
    })
    const res = await app.inject({
      method: 'PATCH',
      url: '/users/me/location',
      headers: { authorization: `Bearer ${token(user.id)}` },
      body: { geohash: GEOHASH_NEAR },
    })
    expect(res.statusCode).toBe(403)
  })

  it('rejeita geohash inválido (400)', async () => {
    const user = await makeUser()
    await testPrisma.userConsent.create({
      data: { userId: user.id, locationPrecise: true },
    })
    const res = await app.inject({
      method: 'PATCH',
      url: '/users/me/location',
      headers: { authorization: `Bearer ${token(user.id)}` },
      body: { geohash: 'XYZ' }, // contém maiúsculas/letras fora do base32 e curto
    })
    expect(res.statusCode).toBe(400)
  })

  it('grava o geohash com consentimento (200) e popula a coluna geográfica', async () => {
    const user = await makeUser()
    await testPrisma.userConsent.create({
      data: { userId: user.id, locationPrecise: true },
    })
    const res = await app.inject({
      method: 'PATCH',
      url: '/users/me/location',
      headers: { authorization: `Bearer ${token(user.id)}` },
      body: { geohash: GEOHASH_NEAR },
    })
    expect(res.statusCode).toBe(200)

    const stored = await testPrisma.user.findUnique({
      where: { id: user.id },
      select: { locationGeohash: true, locationUpdatedAt: true },
    })
    expect(stored?.locationGeohash).toBe(GEOHASH_NEAR)
    expect(stored?.locationUpdatedAt).not.toBeNull()

    const [{ has_location }] = await testPrisma.$queryRaw<
      { has_location: boolean }[]
    >`SELECT location IS NOT NULL AS has_location FROM users WHERE id = ${user.id}`
    expect(has_location).toBe(true)
  })
})

describe('PATCH /users/me/notification-prefs', () => {
  it('retorna 401 sem autenticação', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/users/me/notification-prefs',
      body: { notifyRadiusKm: 10 },
    })
    expect(res.statusCode).toBe(401)
  })

  it('atualiza o raio de interesse', async () => {
    const user = await makeUser()
    const res = await app.inject({
      method: 'PATCH',
      url: '/users/me/notification-prefs',
      headers: { authorization: `Bearer ${token(user.id)}` },
      body: { notifyRadiusKm: 25 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().notifyRadiusKm).toBe(25)
  })

  it('rejeita raio fora dos limites (2–50)', async () => {
    const user = await makeUser()
    const auth = { authorization: `Bearer ${token(user.id)}` }
    const tooLow = await app.inject({
      method: 'PATCH',
      url: '/users/me/notification-prefs',
      headers: auth,
      body: { notifyRadiusKm: 1 },
    })
    expect(tooLow.statusCode).toBe(400)
    const tooHigh = await app.inject({
      method: 'PATCH',
      url: '/users/me/notification-prefs',
      headers: auth,
      body: { notifyRadiusKm: 51 },
    })
    expect(tooHigh.statusCode).toBe(400)
  })
})

describe('findUsersToNotifyNearEvent', () => {
  it('inclui usuário perto, com categoria e consentimento', async () => {
    const author = await makeUser()
    const user = await makeNotifiableUser()

    expect(await scan(author.id)).toContain(user.id)
  })

  it('exclui quem está fora do raio máximo (longe)', async () => {
    const author = await makeUser()
    const far = await makeNotifiableUser({ geohash: GEOHASH_FAR })

    expect(await scan(author.id)).not.toContain(far.id)
  })

  it('respeita o raio por usuário (refino por linha)', async () => {
    const author = await makeUser()
    const small = await makeNotifiableUser({
      geohash: GEOHASH_MID,
      radiusKm: 2,
    })
    const big = await makeNotifiableUser({ geohash: GEOHASH_MID, radiusKm: 10 })

    const ids = await scan(author.id)
    expect(ids).not.toContain(small.id) // ~3.5km > 2km + over-notify
    expect(ids).toContain(big.id) // ~3.5km < 10km
  })

  it('exclui sem categoria, sem consentimentos, velho, sem localização, bloqueado e o autor', async () => {
    // O autor é totalmente elegível (perto + categoria + consent) — mas nunca
    // recebe a notificação da própria criação.
    const author = await makeNotifiableUser()
    const [noCategory, noPush, noLocConsent, stale, noLocation, blocked] =
      await Promise.all([
        makeNotifiableUser({ category: null }),
        makeNotifiableUser({ pushConsent: false }),
        makeNotifiableUser({ locationConsent: false }),
        makeNotifiableUser({
          locationUpdatedAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
        }),
        makeNotifiableUser({ geohash: null }),
        makeNotifiableUser(),
      ])
    await makeBlock(blocked.id, author.id)

    const ids = await scan(author.id)
    expect(ids).not.toContain(author.id)
    expect(ids).not.toContain(noCategory.id)
    expect(ids).not.toContain(noPush.id)
    expect(ids).not.toContain(noLocConsent.id)
    expect(ids).not.toContain(stale.id)
    expect(ids).not.toContain(noLocation.id)
    expect(ids).not.toContain(blocked.id)
  })
})

describe('LGPD — localização', () => {
  async function userWithLocationAndConsent() {
    const user = await makeUser()
    await testPrisma.userConsent.create({
      data: { userId: user.id, locationPrecise: true, pushNotifications: true },
    })
    await testPrisma.user.update({
      where: { id: user.id },
      data: { locationGeohash: GEOHASH_NEAR, locationUpdatedAt: new Date() },
    })
    return user
  }

  async function geohashOf(userId: string) {
    const u = await testPrisma.user.findUnique({
      where: { id: userId },
      select: { locationGeohash: true },
    })
    return u?.locationGeohash ?? null
  }

  it('revogar locationPrecise limpa a localização', async () => {
    const user = await userWithLocationAndConsent()
    await updateConsent(user.id, { locationPrecise: false }, {})
    expect(await geohashOf(user.id)).toBeNull()
  })

  it('revokeAllConsents limpa a localização', async () => {
    const user = await userWithLocationAndConsent()
    await revokeAllConsents(user.id, {})
    expect(await geohashOf(user.id)).toBeNull()
  })

  it('anonimização zera a localização', async () => {
    const user = await makeUser({
      accountStatus: 'PENDING_DELETION',
      scheduledDeletionAt: new Date(),
    })
    await testPrisma.user.update({
      where: { id: user.id },
      data: { locationGeohash: GEOHASH_NEAR, locationUpdatedAt: new Date() },
    })
    await anonymizeUserTx(user.id)
    expect(await geohashOf(user.id)).toBeNull()
  })

  it('reconciler expurga localização além do TTL e mantém a recente', async () => {
    const oldUser = await makeUser()
    const freshUser = await makeUser()
    await testPrisma.user.update({
      where: { id: oldUser.id },
      data: {
        locationGeohash: GEOHASH_NEAR,
        locationUpdatedAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
      },
    })
    await testPrisma.user.update({
      where: { id: freshUser.id },
      data: { locationGeohash: GEOHASH_NEAR, locationUpdatedAt: new Date() },
    })

    const { cleared } = await reconcileLocationRetention(90)
    expect(cleared).toBeGreaterThanOrEqual(1)
    expect(await geohashOf(oldUser.id)).toBeNull()
    expect(await geohashOf(freshUser.id)).toBe(GEOHASH_NEAR)
  })
})
