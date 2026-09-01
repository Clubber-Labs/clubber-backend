import { afterAll, afterEach, beforeAll } from 'vitest'
import { __resetDekCache } from '../lib/crypto/dek-cache'
import { setMailer } from '../lib/mailer'
import { setPlacesClient } from '../lib/places'
import { setPushService } from '../lib/push'
import { redis } from '../lib/redis'
import { setSpotifyClient } from '../lib/spotify'
import { setStorage } from '../lib/storage'
import {
  setProfileQueryComposer,
  setSuggestionEnhancer,
} from '../lib/suggestion-ai'
import { fakeEnhancer } from './fake-enhancer'
import { fakeMailer } from './fake-mailer'
import { fakePlaces } from './fake-places'
import { fakePush } from './fake-push'
import { fakeQueryComposer } from './fake-query-composer'
import { fakeSpotify } from './fake-spotify'
import { fakeStorage } from './fake-storage'
import { testPrisma } from './prisma'

beforeAll(() => {
  setStorage(fakeStorage)
  setMailer(fakeMailer)
  setPushService(fakePush)
  setPlacesClient(fakePlaces)
  setSpotifyClient(fakeSpotify)
  setSuggestionEnhancer(fakeEnhancer)
  setProfileQueryComposer(fakeQueryComposer)
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
    // Antes de report (FK com cascade, mas a ordem explícita evita depender dele)
    // e antes de user, que é o dono do log de acesso da moderação.
    testPrisma.reportEvidence.deleteMany(),
    testPrisma.moderationAccessLog.deleteMany(),
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
    testPrisma.userPhoto.deleteMany(),
    testPrisma.eventInvite.deleteMany(),
    testPrisma.eventInviteLink.deleteMany(),
    testPrisma.eventAttendance.deleteMany(),
    testPrisma.eventCheckIn.deleteMany(),
    testPrisma.featuredEvent.deleteMany(),
    // event (seriesId SetNull) antes de eventSeries; eventSeries antes de user
    // (authorId é RESTRICT).
    testPrisma.event.deleteMany(),
    testPrisma.eventSeries.deleteMany(),
    testPrisma.follow.deleteMany(),
    testPrisma.socialAccount.deleteMany(),
    testPrisma.spotifyTasteSnapshot.deleteMany(),
    testPrisma.spotifyLink.deleteMany(),
    testPrisma.passwordResetCode.deleteMany(),
    testPrisma.user.deleteMany(),
  ])
  // O cache de DEK é global do processo: sem reset, uma conversa recriada com o
  // mesmo id herdaria a chave do teste anterior (e o shred/rotação passariam
  // por engano).
  __resetDekCache()
  fakeStorage.reset()
  fakeMailer.reset()
  fakePush.reset()
  fakePlaces.reset()
  fakeSpotify.reset()
  fakeEnhancer.reset()
  fakeQueryComposer.reset()
  if (redis) await redis.flushdb()
})

afterAll(async () => {
  if (redis) await redis.quit()
})
