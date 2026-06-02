import bcrypt from 'bcryptjs'
import type { EventCategory } from '../lib/event-categories'
import { testPrisma } from './prisma'

let counter = 0
function uid() {
  return `${Date.now()}-${++counter}`
}

export async function makeUser(
  overrides: {
    isPrivate?: boolean
    username?: string
    email?: string
    password?: string | null
    phone?: string | null
    birthdate?: Date | null
    isPremium?: boolean
  } = {},
) {
  const id = uid()
  return testPrisma.user.create({
    data: {
      name: `User${id}`,
      lastname: `Last${id}`,
      username: overrides.username ?? `user_${id}`,
      email: overrides.email ?? `user_${id}@test.com`,
      password:
        overrides.password === null
          ? null
          : (overrides.password ?? bcrypt.hashSync('senha123', 1)),
      phone:
        overrides.phone === null
          ? null
          : (overrides.phone ?? `119${id.slice(-8).padStart(8, '0')}`),
      birthdate:
        overrides.birthdate === null
          ? null
          : (overrides.birthdate ?? new Date('2000-01-01')),
      isPrivate: overrides.isPrivate ?? false,
      isPremium: overrides.isPremium ?? false,
    },
  })
}

export async function makeSocialAccount(
  userId: string,
  provider: 'GOOGLE' | 'FACEBOOK' = 'GOOGLE',
  overrides: { providerUserId?: string; email?: string | null } = {},
) {
  const id = uid()
  return testPrisma.socialAccount.create({
    data: {
      userId,
      provider,
      providerUserId:
        overrides.providerUserId ?? `${provider.toLowerCase()}_${id}`,
      email: overrides.email === undefined ? null : overrides.email,
    },
  })
}

export async function makeEvent(
  authorId: string,
  overrides: {
    isPublic?: boolean
    category?: EventCategory
    date?: Date
    endDate?: Date | null
    canceledAt?: Date | null
    latitude?: number
    longitude?: number
    isFeatured?: boolean
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
      category: overrides.category ?? 'PARTY',
      isPublic: overrides.isPublic ?? true,
      isFeatured: overrides.isFeatured ?? false,
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
    reason?:
      | 'HATE_SPEECH'
      | 'SPAM_OR_FRAUD'
      | 'HARASSMENT'
      | 'INAPPROPRIATE_CONTENT'
      | 'OTHER'
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

export async function makeReaction(userId: string, eventId: string) {
  return testPrisma.reaction.create({
    data: { userId, eventId },
  })
}

export async function makePostReaction(userId: string, postId: string) {
  return testPrisma.reaction.create({
    data: { userId, postId },
  })
}

export async function makeCommentReaction(userId: string, commentId: string) {
  return testPrisma.commentReaction.create({
    data: { userId, commentId },
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

export async function makeUserCategoryPreference(
  userId: string,
  category: EventCategory,
) {
  return testPrisma.userCategoryPreference.create({
    data: { userId, category },
  })
}

export async function makeFeaturedEvent(
  eventId: string,
  createdBy: string,
  overrides: {
    startsAt?: Date
    endsAt?: Date
    canceledAt?: Date | null
  } = {},
) {
  const now = new Date()
  return testPrisma.featuredEvent.create({
    data: {
      eventId,
      createdBy,
      startsAt: overrides.startsAt ?? now,
      endsAt: overrides.endsAt ?? new Date(now.getTime() + 3600_000),
      canceledAt: overrides.canceledAt ?? null,
    },
  })
}

/** Chave determinística do par DIRECT — deve casar com a do chat.repository. */
export function directKeyFor(a: string, b: string) {
  return [a, b].sort().join(':')
}

export async function makeDirectConversation(userAId: string, userBId: string) {
  return testPrisma.conversation.create({
    data: {
      type: 'DIRECT',
      createdById: userAId,
      directKey: directKeyFor(userAId, userBId),
      participants: {
        create: [{ userId: userAId }, { userId: userBId }],
      },
    },
  })
}

export async function makeGroupConversation(
  createdById: string,
  memberIds: string[] = [],
  overrides: { title?: string } = {},
) {
  return testPrisma.conversation.create({
    data: {
      type: 'GROUP',
      title: overrides.title ?? 'Grupo de teste',
      createdById,
      participants: {
        create: [
          { userId: createdById, role: 'ADMIN' },
          ...memberIds.map((userId) => ({ userId })),
        ],
      },
    },
  })
}

export async function makeMessage(
  conversationId: string,
  senderId: string,
  overrides: { content?: string | null; createdAt?: Date } = {},
) {
  return testPrisma.message.create({
    data: {
      conversationId,
      senderId,
      content: overrides.content === undefined ? 'Mensagem' : overrides.content,
      ...(overrides.createdAt && { createdAt: overrides.createdAt }),
    },
  })
}

export async function makeBlock(blockerId: string, blockedId: string) {
  return testPrisma.block.create({
    data: { blockerId, blockedId },
  })
}
