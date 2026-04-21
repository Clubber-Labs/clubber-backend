import { afterEach } from 'vitest'
import { testPrisma } from './prisma'

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
