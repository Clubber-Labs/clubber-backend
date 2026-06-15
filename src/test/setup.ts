import { afterAll, afterEach, beforeAll } from 'vitest'
import { setMailer } from '../lib/mailer'
import { setPlacesClient } from '../lib/places'
import { setPushService } from '../lib/push'
import { redis } from '../lib/redis'
import { setStorage } from '../lib/storage'
import { setSuggestionEnhancer } from '../lib/suggestion-ai'
import { fakeEnhancer } from './fake-enhancer'
import { fakeMailer } from './fake-mailer'
import { fakePlaces } from './fake-places'
import { fakePush } from './fake-push'
import { fakeStorage } from './fake-storage'
import { testPrisma } from './prisma'

beforeAll(() => {
  setStorage(fakeStorage)
  setMailer(fakeMailer)
  setPushService(fakePush)
  setPlacesClient(fakePlaces)
  setSuggestionEnhancer(fakeEnhancer)
})

const dbUrl = process.env.DATABASE_URL ?? ''

if (!dbUrl.includes('test')) {
  throw new Error(
    `PERIGO: DATABASE_URL não aponta para o banco de teste.\nValor atual: "${dbUrl}"\nOs testes só podem rodar contra um banco cujo nome contenha "test".`,
  )
}

const redisUrl = process.env.REDIS_URL ?? ''

if (!redisUrl) {
  throw new Error(
    'PERIGO: REDIS_URL não está definido. Os testes dependem de Redis ativo no database /15.',
  )
}

if (!redisUrl.endsWith('/15')) {
  throw new Error(
    `PERIGO: REDIS_URL não aponta para o database de teste (/15).\nValor atual: "${redisUrl}"`,
  )
}

afterEach(async () => {
  await testPrisma.$transaction([
    testPrisma.webhookEvent.deleteMany(),
    testPrisma.subscription.deleteMany(),
    testPrisma.report.deleteMany(),
    testPrisma.spotGenerationUsage.deleteMany(),
    testPrisma.spotDiscoveryUsage.deleteMany(),
    testPrisma.eventPromotionUsage.deleteMany(),
    // Spot referencia conversation e creator com RESTRICT — apaga antes de ambos.
    testPrisma.spot.deleteMany(),
    // Chat: conversation cascateia participants/messages/attachments;
    // conversation antes de user (createdById é RESTRICT).
    testPrisma.conversation.deleteMany(),
    testPrisma.block.deleteMany(),
    testPrisma.reaction.deleteMany(),
    testPrisma.comment.deleteMany(),
    testPrisma.post.deleteMany(),
    testPrisma.eventInvite.deleteMany(),
    testPrisma.eventAttendance.deleteMany(),
    testPrisma.featuredEvent.deleteMany(),
    // event (seriesId SetNull) antes de eventSeries; eventSeries antes de user
    // (authorId é RESTRICT).
    testPrisma.event.deleteMany(),
    testPrisma.eventSeries.deleteMany(),
    testPrisma.follow.deleteMany(),
    testPrisma.socialAccount.deleteMany(),
    testPrisma.passwordResetCode.deleteMany(),
    testPrisma.user.deleteMany(),
  ])
  fakeStorage.reset()
  fakeMailer.reset()
  fakePush.reset()
  fakePlaces.reset()
  fakeEnhancer.reset()
  if (redis) await redis.flushdb()
})

afterAll(async () => {
  if (redis) await redis.quit()
})
