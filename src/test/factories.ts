import { createHash, randomBytes } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import bcrypt from 'bcryptjs'
import type { EventCategory } from '../lib/event-categories'
import { testPrisma } from './prisma'

// Cria um refresh token persistido (hash) e devolve o valor BRUTO p/ usar nas
// requisições. Permite forjar estado (expirado/revogado) nos testes de rotação.
export async function makeRefreshToken(
  userId: string,
  overrides: {
    expiresAt?: Date
    revokedAt?: Date | null
    // `rotatedAt` marca revogação por ROTAÇÃO (≠ logout/reset): permite forjar um
    // token rotacionado dentro/fora da janela de carência nos testes de reuso.
    rotatedAt?: Date | null
    replacedByTokenId?: string | null
  } = {},
) {
  const raw = randomBytes(32).toString('base64url')
  const tokenHash = createHash('sha256').update(raw).digest('hex')
  const record = await testPrisma.refreshToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 90 * 86_400_000),
      revokedAt: overrides.revokedAt ?? null,
      rotatedAt: overrides.rotatedAt ?? null,
      replacedByTokenId: overrides.replacedByTokenId ?? null,
    },
  })
  return { raw, record }
}

// Cria um código de reset de senha. Permite forjar estado (usado/expirado) para
// os testes do reconciler de expurgo.
export async function makePasswordResetCode(
  userId: string,
  overrides: { codeHash?: string; expiresAt?: Date; usedAt?: Date | null } = {},
) {
  return testPrisma.passwordResetCode.create({
    data: {
      userId,
      codeHash: overrides.codeHash ?? 'hash',
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60_000),
      usedAt: overrides.usedAt ?? null,
    },
  })
}

let counter = 0
function uid() {
  return `${Date.now()}-${++counter}`
}

export async function makeUser(
  overrides: {
    name?: string
    lastname?: string
    isPrivate?: boolean
    username?: string
    email?: string
    password?: string | null
    phone?: string | null
    birthdate?: Date | null
    isPremium?: boolean
    role?: 'USER' | 'ADMIN'
    accountStatus?:
      | 'ACTIVE'
      | 'DEACTIVATED'
      | 'PENDING_DELETION'
      | 'ANONYMIZED'
      | 'SUSPENDED'
      | 'BANNED'
    deactivatedAt?: Date | null
    scheduledDeletionAt?: Date | null
    anonymizedAt?: Date | null
    suspendedAt?: Date | null
    suspendedUntil?: Date | null
    suspensionReason?: string | null
    spotRadiusKm?: number
  } = {},
) {
  const id = uid()
  return testPrisma.user.create({
    data: {
      name: overrides.name ?? `User${id}`,
      lastname: overrides.lastname ?? `Last${id}`,
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
      role: overrides.role ?? 'USER',
      accountStatus: overrides.accountStatus ?? 'ACTIVE',
      deactivatedAt: overrides.deactivatedAt ?? null,
      scheduledDeletionAt: overrides.scheduledDeletionAt ?? null,
      anonymizedAt: overrides.anonymizedAt ?? null,
      suspendedAt: overrides.suspendedAt ?? null,
      suspendedUntil: overrides.suspendedUntil ?? null,
      suspensionReason: overrides.suspensionReason ?? null,
      ...(overrides.spotRadiusKm !== undefined && {
        spotRadiusKm: overrides.spotRadiusKm,
      }),
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
    /** Atalho legado: uma categoria única (vira `[category]`). */
    category?: EventCategory
    categories?: EventCategory[]
    subcategories?: string[]
    date?: Date
    endDate?: Date | null
    canceledAt?: Date | null
    latitude?: number
    longitude?: number
    isFeatured?: boolean
    title?: string
    description?: string
    address?: string | null
    seriesId?: string | null
  } = {},
) {
  const id = uid()
  return testPrisma.event.create({
    data: {
      title: overrides.title ?? `Event ${id}`,
      description: overrides.description ?? `Description ${id}`,
      address: overrides.address ?? null,
      date: overrides.date ?? new Date(Date.now() + 86400000),
      endDate: overrides.endDate ?? null,
      latitude: overrides.latitude ?? -25.4,
      longitude: overrides.longitude ?? -49.3,
      categories:
        overrides.categories ??
        (overrides.category ? [overrides.category] : ['PARTY']),
      ...(overrides.subcategories && {
        subcategories: overrides.subcategories,
      }),
      isPublic: overrides.isPublic ?? true,
      isFeatured: overrides.isFeatured ?? false,
      canceledAt: overrides.canceledAt ?? null,
      seriesId: overrides.seriesId ?? null,
      authorId,
    },
  })
}

export async function makeEventSeries(
  authorId: string,
  overrides: {
    frequency?: 'WEEKLY' | 'MONTHLY'
    interval?: number
    until?: Date | null
    count?: number | null
    canceledAt?: Date | null
    title?: string
    description?: string | null
    latitude?: number
    longitude?: number
    address?: string | null
    /** Atalho legado: uma categoria única (vira `[category]`). */
    category?: EventCategory
    categories?: EventCategory[]
    subcategories?: string[]
    maxCapacity?: number | null
    isPublic?: boolean
    durationMs?: number | null
  } = {},
) {
  const id = uid()
  return testPrisma.eventSeries.create({
    data: {
      authorId,
      frequency: overrides.frequency ?? 'WEEKLY',
      interval: overrides.interval ?? 1,
      until: overrides.until ?? null,
      count: overrides.count ?? null,
      canceledAt: overrides.canceledAt ?? null,
      // Template default-preenchido: o reconciler pula séries sem template.
      title: overrides.title ?? `Série ${id}`,
      description: overrides.description ?? null,
      latitude: overrides.latitude ?? -25.4,
      longitude: overrides.longitude ?? -49.3,
      address: overrides.address ?? null,
      categories:
        overrides.categories ??
        (overrides.category ? [overrides.category] : ['PARTY']),
      ...(overrides.subcategories && {
        subcategories: overrides.subcategories,
      }),
      maxCapacity: overrides.maxCapacity ?? null,
      isPublic: overrides.isPublic ?? true,
      durationMs: overrides.durationMs ?? null,
    },
  })
}

export async function makeEventImage(
  eventId: string,
  overrides: {
    url?: string
    key?: string
    format?: string
    size?: number
    order?: number
  } = {},
) {
  const id = uid()
  return testPrisma.eventImage.create({
    data: {
      eventId,
      url: overrides.url ?? `https://cdn.test/${id}.webp`,
      key: overrides.key ?? `events/${eventId}/${id}`,
      format: overrides.format ?? 'webp',
      size: overrides.size ?? 1024,
      order: overrides.order ?? 0,
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
  overrides: { createdAt?: Date } = {},
) {
  return testPrisma.eventAttendance.create({
    data: {
      userId,
      eventId,
      type,
      ...(overrides.createdAt && { createdAt: overrides.createdAt }),
    },
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
    messageId?: string
    postId?: string
    targetUserId?: string
    reason?:
      | 'HATE_SPEECH'
      | 'SPAM_OR_FRAUD'
      | 'HARASSMENT'
      | 'INAPPROPRIATE_CONTENT'
      | 'OTHER'
    status?: 'PENDING' | 'REVIEWED' | 'RESOLVED_INVALID' | 'RESOLVED_REMOVED'
    reviewerId?: string
    resolutionNote?: string | null
    resolvedAt?: Date | null
  } = {},
) {
  return testPrisma.report.create({
    data: {
      reporterId,
      reason: overrides.reason ?? 'SPAM_OR_FRAUD',
      status: overrides.status ?? 'PENDING',
      eventId: overrides.eventId,
      commentId: overrides.commentId,
      messageId: overrides.messageId,
      postId: overrides.postId,
      targetUserId: overrides.targetUserId,
      reviewerId: overrides.reviewerId,
      resolutionNote: overrides.resolutionNote,
      resolvedAt: overrides.resolvedAt,
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

export async function makePost(
  authorId: string,
  eventId: string,
  overrides: { content?: string } = {},
) {
  return testPrisma.post.create({
    data: { authorId, eventId, content: overrides.content ?? 'Post de teste' },
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

export async function makeUserSubcategoryPreference(
  userId: string,
  subcategory: string,
) {
  return testPrisma.userSubcategoryPreference.create({
    data: { userId, subcategory },
  })
}

/** Pré-popula o cap de descoberta do dia (CURRENT_DATE) — para testar o teto. */
export async function makeSpotDiscoveryUsage(userId: string, count: number) {
  return testPrisma.$executeRaw`
    INSERT INTO "spot_discovery_usage" ("userId", "day", "count", "updatedAt")
    VALUES (${userId}, CURRENT_DATE, ${count}, now())`
}

/** Pré-popula a quota diária de geração (CURRENT_DATE) — para testar o limite. */
export async function makeSpotGenerationUsage(userId: string, count: number) {
  return testPrisma.$executeRaw`
    INSERT INTO "spot_generation_usage" ("userId", "day", "count", "updatedAt")
    VALUES (${userId}, CURRENT_DATE, ${count}, now())`
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

type SubscriptionStatusLiteral =
  | 'TRIALING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'CANCELED'
  | 'INCOMPLETE'
  | 'INCOMPLETE_EXPIRED'
  | 'UNPAID'

export async function makeSubscription(
  userId: string,
  overrides: {
    stripeSubscriptionId?: string
    stripePriceId?: string
    status?: SubscriptionStatusLiteral
    trialEndsAt?: Date | null
    currentPeriodStart?: Date
    currentPeriodEnd?: Date
    cancelAtPeriodEnd?: boolean
    canceledAt?: Date | null
    defaultPaymentMethodId?: string | null
    lastSyncedAt?: Date
  } = {},
) {
  const id = uid()
  const now = new Date()
  const periodEnd =
    overrides.currentPeriodEnd ?? new Date(now.getTime() + 30 * 86_400_000)
  return testPrisma.subscription.create({
    data: {
      userId,
      stripeSubscriptionId: overrides.stripeSubscriptionId ?? `sub_test_${id}`,
      stripePriceId: overrides.stripePriceId ?? `price_test_${id}`,
      status: overrides.status ?? 'TRIALING',
      trialEndsAt:
        overrides.trialEndsAt ?? new Date(now.getTime() + 7 * 86_400_000),
      currentPeriodStart: overrides.currentPeriodStart ?? now,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: overrides.cancelAtPeriodEnd ?? false,
      canceledAt: overrides.canceledAt ?? null,
      defaultPaymentMethodId: overrides.defaultPaymentMethodId ?? null,
      lastSyncedAt: overrides.lastSyncedAt ?? now,
    },
  })
}

/** Evento de webhook Stripe já processado (linha de idempotência do billing). */
export async function makeWebhookEvent(
  overrides: {
    stripeEventId?: string
    type?: string
    processedAt?: Date
    payload?: Prisma.InputJsonValue
  } = {},
) {
  const id = uid()
  return testPrisma.webhookEvent.create({
    data: {
      stripeEventId: overrides.stripeEventId ?? `evt_test_${id}`,
      type: overrides.type ?? 'customer.subscription.updated',
      processedAt: overrides.processedAt ?? new Date(),
      payload: overrides.payload ?? {},
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

export async function makeAnalyticsMetric(
  eventId: string,
  type: 'VIEW' | 'SHARE',
  occurredAt: Date,
) {
  return testPrisma.eventAnalyticsMetric.create({
    data: { eventId, type, occurredAt },
  })
}

export async function makeConsentAuditLog(
  userId: string,
  action: 'GRANTED' | 'UPDATED' | 'REVOKED' | 'EXPORTED' = 'GRANTED',
) {
  return testPrisma.consentAuditLog.create({
    data: {
      userId,
      action,
      changedFields: [{ field: 'analytics', from: null, to: true }],
      consentVersion: '1.0',
      ipAddress: '192.168.1.1',
    },
  })
}

export async function makeUserConsent(userId: string) {
  return testPrisma.userConsent.upsert({
    where: { userId },
    create: {
      userId,
      analytics: true,
      marketing: false,
      consentVersion: '1.0',
    },
    update: { analytics: true },
  })
}

/**
 * Cria um spot já publicado: a conversa GROUP aberta (criador como ADMIN) + o
 * spot ligado a ela. Janela ativa por padrão (começou há 1h, termina em 3h).
 */
export async function makeSpot(
  creatorId: string,
  overrides: {
    title?: string
    description?: string | null
    categories?: EventCategory[]
    subcategories?: string[]
    visibility?: 'PUBLIC' | 'FRIENDS'
    placeId?: string
    latitude?: number
    longitude?: number
    startsAt?: Date
    endsAt?: Date
    canceledAt?: Date | null
    memberIds?: string[]
  } = {},
) {
  const id = uid()
  const conversation = await testPrisma.conversation.create({
    data: {
      type: 'GROUP',
      title: overrides.title ?? `Rolê ${id}`,
      createdById: creatorId,
      participants: {
        create: [
          { userId: creatorId, role: 'ADMIN' },
          ...(overrides.memberIds ?? []).map((userId) => ({ userId })),
        ],
      },
    },
  })
  const now = Date.now()
  return testPrisma.spot.create({
    data: {
      title: overrides.title ?? `Rolê ${id}`,
      description: overrides.description ?? null,
      categories: overrides.categories ?? ['PARTY'],
      ...(overrides.subcategories && {
        subcategories: overrides.subcategories,
      }),
      visibility: overrides.visibility ?? 'PUBLIC',
      placeId: overrides.placeId ?? `place_${id}`,
      latitude: overrides.latitude ?? -25.4,
      longitude: overrides.longitude ?? -49.3,
      startsAt: overrides.startsAt ?? new Date(now - 3600_000),
      endsAt: overrides.endsAt ?? new Date(now + 3 * 3600_000),
      canceledAt: overrides.canceledAt ?? null,
      creatorId,
      conversationId: conversation.id,
    },
  })
}
