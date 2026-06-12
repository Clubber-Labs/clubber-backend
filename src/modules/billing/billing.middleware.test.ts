import { afterAll, describe, expect, it } from 'vitest'
import { makeUser } from '../../test/factories'
import { testPrisma } from '../../test/prisma'
import { requirePremium } from './billing.middleware'

afterAll(async () => {
  await testPrisma.$disconnect()
})

function makeRequest(sub?: string) {
  return { user: sub ? { sub } : undefined } as unknown as Parameters<
    typeof requirePremium
  >[0]
}

const fakeReply = {} as unknown as Parameters<typeof requirePremium>[1]

describe('requirePremium', () => {
  it('lança 401 quando request.user.sub não existe (auth não rodou)', async () => {
    await expect(
      requirePremium(makeRequest(), fakeReply),
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it('lança 403 quando user existe mas isPremium=false', async () => {
    const user = await makeUser({ isPremium: false })

    await expect(
      requirePremium(makeRequest(user.id), fakeReply),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('lança 403 quando o userId aponta pra user inexistente', async () => {
    await expect(
      requirePremium(
        makeRequest('00000000-0000-0000-0000-000000000000'),
        fakeReply,
      ),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('passa silenciosamente quando user.isPremium=true', async () => {
    const user = await makeUser({ isPremium: true })

    await expect(
      requirePremium(makeRequest(user.id), fakeReply),
    ).resolves.toBeUndefined()
  })
})
