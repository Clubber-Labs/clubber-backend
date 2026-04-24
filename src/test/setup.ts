import { afterEach } from 'vitest'
import { testPrisma } from './prisma'

const dbUrl = process.env.DATABASE_URL ?? ''

if (!dbUrl.includes('test')) {
  throw new Error(
    `PERIGO: DATABASE_URL não aponta para o banco de teste.\nValor atual: "${dbUrl}"\nOs testes só podem rodar contra um banco cujo nome contenha "test".`,
  )
}

afterEach(async () => {
  await testPrisma.$transaction([
    testPrisma.reaction.deleteMany(),
    testPrisma.comment.deleteMany(),
    testPrisma.post.deleteMany(),
    testPrisma.eventInvite.deleteMany(),
    testPrisma.eventAttendance.deleteMany(),
    testPrisma.event.deleteMany(),
    testPrisma.follow.deleteMany(),
    testPrisma.user.deleteMany(),
  ])
})
