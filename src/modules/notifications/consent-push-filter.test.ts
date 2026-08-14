import type { EventCategory } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'
import { makeUser } from '../../test/factories'
import { testPrisma } from '../../test/prisma'
import { findChatPushRecipientUserIds } from './chat-push.repository'
import { findUsersToNotifyNearEvent } from './proximity.repository'

/**
 * Regressão da separação consentimento × preferência de produto: os JOINs de
 * push filtram por locationPrecise/pushNotifications em user_consents, e as três
 * preferências que foram para o User não podem influenciar quem é seleção.
 */
const GEOHASH = '6gkzwg'
const LAT = -25.38116
const LNG = -49.26819
const CATEGORY: EventCategory = 'MUSIC'

const scan = { maxRadiusKm: 50, ttlDays: 30, limit: 100 }

function target(authorId: string) {
  return {
    longitude: LNG,
    latitude: LAT,
    categories: [CATEGORY],
    subcategories: [],
    authorId,
  }
}

async function makeNearbyUser(
  consent: { locationPrecise?: boolean; pushNotifications?: boolean } = {},
  preferences: {
    socialFeed?: boolean
    socialVisibility?: boolean
    analytics?: boolean
  } = {},
) {
  const user = await makeUser()
  await testPrisma.user.update({
    where: { id: user.id },
    data: {
      locationGeohash: GEOHASH,
      locationUpdatedAt: new Date(),
      notifyRadiusKm: 10,
      ...preferences,
    },
  })
  await testPrisma.userConsent.update({
    where: { userId: user.id },
    data: {
      locationPrecise: consent.locationPrecise ?? true,
      pushNotifications: consent.pushNotifications ?? true,
    },
  })
  await testPrisma.userCategoryPreference.create({
    data: { userId: user.id, category: CATEGORY },
  })
  return user
}

afterAll(async () => {
  await testPrisma.$disconnect()
})

describe('filtro de push por consentimento', () => {
  it('seleciona por user_consents e ignora as preferências que foram para o User', async () => {
    const author = await makeUser()

    const consented = await makeNearbyUser()
    // Mesmo consentimento, preferências de produto todas desligadas: o SQL não
    // olha para elas, então continua sendo alvo de push.
    const optedOutOfPreferences = await makeNearbyUser(
      {},
      { socialFeed: false, socialVisibility: false, analytics: false },
    )
    const noPush = await makeNearbyUser({ pushNotifications: false })
    const noLocation = await makeNearbyUser({ locationPrecise: false })

    const ids = await findUsersToNotifyNearEvent(target(author.id), scan)

    expect(ids).toContain(consented.id)
    expect(ids).toContain(optedOutOfPreferences.id)
    expect(ids).not.toContain(noPush.id)
    expect(ids).not.toContain(noLocation.id)
  })

  it('exclui quem revogou, mesmo com os campos ligados', async () => {
    const author = await makeUser()
    const revoked = await makeNearbyUser()

    await testPrisma.userConsent.update({
      where: { userId: revoked.id },
      data: { revokedAt: new Date() },
    })

    const ids = await findUsersToNotifyNearEvent(target(author.id), scan)
    expect(ids).not.toContain(revoked.id)
  })

  it('push de chat também ignora as preferências de produto', async () => {
    const sender = await makeUser()
    const recipient = await makeUser()

    await testPrisma.user.update({
      where: { id: recipient.id },
      data: { socialFeed: false, socialVisibility: false, analytics: false },
    })
    await testPrisma.userConsent.update({
      where: { userId: recipient.id },
      data: { pushNotifications: true },
    })

    const conversation = await testPrisma.conversation.create({
      data: {
        type: 'DIRECT',
        createdById: sender.id,
        participants: {
          create: [{ userId: sender.id }, { userId: recipient.id }],
        },
      },
    })

    const ids = await findChatPushRecipientUserIds(
      conversation.id,
      sender.id,
      new Date(),
    )

    expect(ids).toContain(recipient.id)
  })
})
