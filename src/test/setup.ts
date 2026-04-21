import { afterEach } from 'vitest'
import { testPrisma } from './prisma'

afterEach(async () => {
  // Limpa todas as tabelas em ordem que respeita FKs
  await testPrisma.$executeRawUnsafe('SET session_replication_role = replica')
  await testPrisma.reaction.deleteMany()
  await testPrisma.comment.deleteMany()
  await testPrisma.post.deleteMany()
  await testPrisma.eventInvite.deleteMany()
  await testPrisma.eventAttendance.deleteMany()
  await testPrisma.event.deleteMany()
  await testPrisma.follow.deleteMany()
  await testPrisma.user.deleteMany()
  await testPrisma.$executeRawUnsafe('SET session_replication_role = DEFAULT')
})
