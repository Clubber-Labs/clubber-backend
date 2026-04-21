import bcrypt from 'bcryptjs'
import { testPrisma } from './prisma'

let counter = 0
function uid() {
  return `${Date.now()}-${++counter}`
}

export async function makeUser(
  overrides: { isPrivate?: boolean; username?: string } = {},
) {
  const id = uid()
  return testPrisma.user.create({
    data: {
      name: `User${id}`,
      lastname: `Last${id}`,
      username: overrides.username ?? `user_${id}`,
      email: `user_${id}@test.com`,
      password: bcrypt.hashSync('senha123', 1),
      phone: `119${id.slice(-8).padStart(8, '0')}`,
      birthdate: new Date('2000-01-01'),
      isPrivate: overrides.isPrivate ?? false,
    },
  })
}

export async function makeEvent(
  authorId: string,
  overrides: { isPublic?: boolean } = {},
) {
  const id = uid()
  return testPrisma.event.create({
    data: {
      title: `Event ${id}`,
      description: `Description ${id}`,
      date: new Date(Date.now() + 86400000),
      latitude: -25.4,
      longitude: -49.3,
      category: 'Festa',
      isPublic: overrides.isPublic ?? true,
      authorId,
    },
  })
}

export async function makeFollow(
  followerId: string,
  followingId: string,
  status: 'ACCEPTED' | 'PENDING' = 'ACCEPTED',
) {
  return testPrisma.follow.create({
    data: { followerId, followingId, status },
  })
}

export async function makeAttendance(
  userId: string,
  eventId: string,
  type: 'CONFIRMED' | 'INTERESTED' | 'NOT_INTERESTED' = 'CONFIRMED',
) {
  return testPrisma.eventAttendance.create({
    data: { userId, eventId, type },
  })
}

export async function makeInvite(
  eventId: string,
  inviterId: string,
  invitedId: string,
) {
  return testPrisma.eventInvite.create({
    data: { eventId, inviterId, invitedId },
  })
}
