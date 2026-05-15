import bcrypt from 'bcryptjs'
import { testPrisma } from './prisma'
import { hash } from 'node:crypto';

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
      role: 'USER',
    },
  })
}

export async function makeEvent(
  authorId: string,
  overrides: {
    isPublic?: boolean
    category?: string
    date?: Date
    endDate?: Date | null
    canceledAt?: Date | null
    latitude?: number
    longitude?: number
  } = {},
) {
  const id = uid()
  return testPrisma.event.create({
    data: {
      title: `Event ${id}`,
      description: `Description ${id}`,
      date: overrides.date ?? new Date(Date.now() + 86400000),
      endDate: overrides.endDate ?? null,
      latitude: overrides.latitude ?? -25.4,
      longitude: overrides.longitude ?? -49.3,
      category: overrides.category ?? 'Festa',
      isPublic: overrides.isPublic ?? true,
      canceledAt: overrides.canceledAt ?? null,
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

export async function makeReport(
  reporterId: string,
  overrides: {
    eventId?: string
    commentId?: string
    reason?: 'HATE_SPEECH' | 'SPAM_OR_FRAUD' | 'HARASSMENT' | 'INAPPROPRIATE_CONTENT' | 'OTHER'
    status?: 'PENDING' | 'REVIEWED' | 'RESOLVED_INVALID' | 'RESOLVED_REMOVED'
  } = {},
) {
  return testPrisma.report.create({
    data: {
      reporterId,
      reason: overrides.reason ?? 'SPAM_OR_FRAUD',
      status: overrides.status ?? 'PENDING',
      eventId: overrides.eventId,
      commentId: overrides.commentId,
    },
  })
}

export async function makeReaction(
  userId: string,
  eventId: string,
  type: 'LIKE' | 'LOVE' | 'HAHA' | 'WOW' | 'SAD' | 'ANGRY' = 'LIKE',
) {
  return testPrisma.reaction.create({
    data: { userId, eventId, type },
  })
}

export async function makeComment(
  authorId: string,
  eventId: string,
  content = 'Comentário de teste',
) {
  return testPrisma.comment.create({
    data: { authorId, eventId, content },
  })
}

export async function makeAdmin(
  overrides?: Partial<{ username: string }>
) {
  const id = uid()
  return testPrisma.user.create({
    data: {
      name: 'Admin',
      lastname: 'Teste',
      username: overrides?.username ?? `admin_${uid()}`,
      email: `admin_${uid()}@test.com`,
      password: bcrypt.hashSync('senha123', 1),
      phone: `119${id.slice(-8).padStart(8, '0')}`,
      birthdate: new Date('2000-01-01'),
      role: 'ADMIN',
    }
  })
}