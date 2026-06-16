import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { EventCategory } from '../../lib/event-categories'
import { buildApp } from '../../test/app'
import {
  makeBlock,
  makeUser,
  makeUserSubcategoryPreference,
} from '../../test/factories'
import { testPrisma } from '../../test/prisma'
import { revokeAllConsents, updateConsent } from '../consent/consent.service'
import { anonymizeUserTx } from '../users/users.repository'
import { reconcileLocationRetention } from './location-retention.reconciler'
import {
  findUsersToNotifyNearEvent,
  findUsersToNotifyNearSpot,
} from './proximity.repository'

let app: FastifyInstance

function token(userId: string) {
  return app.jwt.sign({ sub: userId })
}

const EVENT = {
  longitude: -49.26819,
  latitude: -25.38116,
  categories: ['MUSIC'] as EventCategory[],
  subcategories: [] as string[],
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
      data: { userId: user.id, category: opts.category ?? EVENT.categories[0] },
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

  it('GET /users/me expõe o raio atual (o app lê após troca de device)', async () => {
    const user = await makeUser()
    const auth = { authorization: `Bearer ${token(user.id)}` }
    await app.inject({
      method: 'PATCH',
      url: '/users/me/notification-prefs',
      headers: auth,
      body: { notifyRadiusKm: 30 },
    })

    const me = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: auth,
    })
    expect(me.statusCode).toBe(200)
    expect(me.json().notifyRadiusKm).toBe(30)
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

  it('notifica por interseção: prefere QUALQUER categoria do evento', async () => {
    const author = await makeUser()
    // Evento MUSIC+ART. onlyArt prefere só ART → casa pela interseção.
    // onlySports não compartilha nenhuma → fica de fora.
    const onlyArt = await makeNotifiableUser({ category: 'ART' })
    const onlySports = await makeNotifiableUser({ category: 'SPORTS' })

    const ids = await findUsersToNotifyNearEvent(
      { ...EVENT, categories: ['MUSIC', 'ART'], authorId: author.id },
      SCAN,
    )
    expect(ids).toContain(onlyArt.id)
    expect(ids).not.toContain(onlySports.id)
  })

  it('notifica por subcategoria preferida mesmo sem casar a categoria', async () => {
    const author = await makeUser()
    // Sem preferência de categoria; só o interesse fino (PARTY_BALADA).
    const subFan = await makeNotifiableUser({ category: null })
    await makeUserSubcategoryPreference(subFan.id, 'PARTY_BALADA')
    // Quem não compartilha nem categoria nem subcategoria fica de fora.
    const unrelated = await makeNotifiableUser({ category: null })
    await makeUserSubcategoryPreference(unrelated.id, 'NIGHTLIFE_BAR')

    const ids = await findUsersToNotifyNearEvent(
      { ...EVENT, subcategories: ['PARTY_BALADA'], authorId: author.id },
      SCAN,
    )
    expect(ids).toContain(subFan.id)
    expect(ids).not.toContain(unrelated.id)
  })

  it('a categoria cobre, mesmo com subcategoria não-preferida no evento', async () => {
    const author = await makeUser()
    // Prefere a CATEGORIA (MUSIC, default) mas NÃO a subcategoria do evento — o
    // evento carrega subcategoria, então subPref é um EXISTS vivo (não o FALSE de
    // array vazio): mesmo assim catPref deve cobrir e incluir o usuário.
    const catFan = await makeNotifiableUser()
    await makeUserSubcategoryPreference(catFan.id, 'NIGHTLIFE_BAR')
    // Não casa nem categoria nem subcategoria → de fora.
    const unrelated = await makeNotifiableUser({ category: null })
    await makeUserSubcategoryPreference(unrelated.id, 'NIGHTLIFE_BAR')

    const ids = await findUsersToNotifyNearEvent(
      {
        ...EVENT,
        categories: ['MUSIC'],
        subcategories: ['GENRE_FUNK'],
        authorId: author.id,
      },
      SCAN,
    )
    expect(ids).toContain(catFan.id)
    expect(ids).not.toContain(unrelated.id)
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

// Descoberta (alcance premium) = preferência INVERTIDA: AND NOT (catPref OR
// subPref). Testar direto no repositório, não via runSpotPublishedFanout: lá a
// passada de audiência já notifica quem prefere a subcategoria com o MESMO
// dedupeKey, então o dedupe mascara se o ramo NOT subPref está certo. Aqui a
// borda De Morgan fica observável.
describe('findUsersToNotifyNearSpot — preferência de 2 níveis na descoberta', () => {
  const spotTarget = (creatorId: string) => ({
    ...EVENT, // categories: ['MUSIC']
    subcategories: ['PARTY_BALADA'],
    authorId: creatorId,
    visibility: 'PUBLIC' as const,
  })

  it('descoberta EXCLUI quem prefere a subcategoria do spot (NOT subPref)', async () => {
    const creator = await makeUser()
    // Prefere a SUBcategoria do spot (não a categoria) → audiência, não descoberta.
    const subFan = await makeNotifiableUser({ category: 'SPORTS' })
    await makeUserSubcategoryPreference(subFan.id, 'PARTY_BALADA')
    // Não prefere nem categoria nem subcategoria → alvo legítimo de descoberta.
    const neutral = await makeNotifiableUser({ category: 'SPORTS' })

    const ids = await findUsersToNotifyNearSpot(spotTarget(creator.id), SCAN, {
      discovery: true,
    })
    // NOT (false OR true) = false → subFan fora; neutral (NOT false) entra.
    expect(ids).not.toContain(subFan.id)
    expect(ids).toContain(neutral.id)
  })

  it('audiência INCLUI quem prefere a subcategoria do spot (subPref cobre)', async () => {
    const creator = await makeUser()
    const subFan = await makeNotifiableUser({ category: 'SPORTS' })
    await makeUserSubcategoryPreference(subFan.id, 'PARTY_BALADA')
    const neutral = await makeNotifiableUser({ category: 'SPORTS' })

    const ids = await findUsersToNotifyNearSpot(spotTarget(creator.id), SCAN, {
      discovery: false,
    })
    // (false OR true) → subFan entra; neutral (false OR false) fora — o mesmo
    // par de usuários inverte exatamente entre audiência e descoberta.
    expect(ids).toContain(subFan.id)
    expect(ids).not.toContain(neutral.id)
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
