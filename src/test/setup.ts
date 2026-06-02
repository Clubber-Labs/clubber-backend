import { afterAll, afterEach, beforeAll } from 'vitest'
import { redis } from '../lib/redis'
import { setStorage } from '../lib/storage'
import { fakeStorage } from './fake-storage'
import { testPrisma } from './prisma'

beforeAll(() => {
  setStorage(fakeStorage)
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
    testPrisma.event.deleteMany(),
    testPrisma.follow.deleteMany(),
    testPrisma.socialAccount.deleteMany(),
    testPrisma.user.deleteMany(),
  ])
  fakeStorage.reset()
  if (redis) await redis.flushdb()
})

afterAll(async () => {
  if (redis) await redis.quit()
})
