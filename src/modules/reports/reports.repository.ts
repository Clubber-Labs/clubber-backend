import type { Prisma, ReportStatus } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import type { CreateReportBody, ListReportsQuery } from './reports.schema'

// Resolução escrevível: REVIEWED + qualquer RESOLVED_* (inclui os de moderação,
// SUSPENDED/BANNED, que vêm do fluxo de moderate-user, não do PATCH público).
type ResolutionUpdate = {
  status: Exclude<ReportStatus, 'PENDING'>
  resolutionNote?: string
}

const reportInclude = {
  reporter: {
    select: {
      id: true,
      name: true,
      lastname: true,
      username: true,
      email: true,
    },
  },
  targetUser: {
    select: {
      id: true,
      name: true,
      lastname: true,
      username: true,
      email: true,
    },
  },
  event: {
    select: {
      id: true,
      title: true,
      authorId: true,
      date: true,
      isPublic: true,
      canceledAt: true,
    },
  },
  comment: {
    select: {
      id: true,
      content: true,
      authorId: true,
      eventId: true,
      postId: true,
      createdAt: true,
      post: {
        select: {
          id: true,
          eventId: true,
        },
      },
    },
  },
  message: {
    select: {
      id: true,
      content: true,
      senderId: true,
      conversationId: true,
      createdAt: true,
    },
  },
  post: {
    select: {
      id: true,
      content: true,
      authorId: true,
      eventId: true,
      createdAt: true,
      author: {
        select: {
          id: true,
          name: true,
          lastname: true,
          username: true,
          avatarUrl: true,
        },
      },
      event: {
        select: {
          id: true,
          title: true,
        },
      },
      images: {
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          url: true,
          format: true,
          size: true,
          order: true,
        },
      },
    },
  },
  reviewer: {
    select: {
      id: true,
      name: true,
      lastname: true,
      username: true,
      email: true,
    },
  },
} satisfies Prisma.ReportInclude

export async function findCommentById(commentId: string) {
  return prisma.comment.findUnique({
    where: { id: commentId },
    include: {
      post: {
        select: {
          id: true,
          eventId: true,
        },
      },
    },
  })
}

export async function findReportPostById(postId: string) {
  return prisma.post.findUnique({
    where: { id: postId },
    select: {
      id: true,
      authorId: true,
      eventId: true,
    },
  })
}

export async function findMessageById(messageId: string) {
  return prisma.message.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      conversationId: true,
      senderId: true,
      deletedAt: true,
    },
  })
}

export async function findReportTargetUserById(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  })
}

export async function findUserRoleById(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  })
}

export async function findActiveConversationParticipant(
  conversationId: string,
  userId: string,
) {
  return prisma.conversationParticipant.findFirst({
    where: { conversationId, userId, leftAt: null },
    select: { userId: true },
  })
}

export async function findExistingEventReport(
  reporterId: string,
  eventId: string,
) {
  return prisma.report.findFirst({
    where: { reporterId, eventId, status: { in: ['PENDING', 'REVIEWED'] } },
  })
}

export async function findExistingCommentReport(
  reporterId: string,
  commentId: string,
) {
  return prisma.report.findFirst({
    where: { reporterId, commentId, status: { in: ['PENDING', 'REVIEWED'] } },
  })
}

export async function findExistingMessageReport(
  reporterId: string,
  messageId: string,
) {
  return prisma.report.findFirst({
    where: { reporterId, messageId, status: { in: ['PENDING', 'REVIEWED'] } },
  })
}

export async function findExistingPostReport(
  reporterId: string,
  postId: string,
) {
  return prisma.report.findFirst({
    where: { reporterId, postId, status: { in: ['PENDING', 'REVIEWED'] } },
  })
}

export async function findExistingUserReport(
  reporterId: string,
  targetUserId: string,
) {
  return prisma.report.findFirst({
    where: {
      reporterId,
      targetUserId,
      status: { in: ['PENDING', 'REVIEWED'] },
    },
  })
}

export async function createEventReport(
  data: CreateReportBody,
  reporterId: string,
  eventId: string,
) {
  return prisma.report.create({
    data: { ...data, reporterId, eventId },
  })
}

export async function createCommentReport(
  data: CreateReportBody,
  reporterId: string,
  commentId: string,
) {
  return prisma.report.create({
    data: { ...data, reporterId, commentId },
  })
}

export async function createMessageReport(
  data: CreateReportBody,
  reporterId: string,
  messageId: string,
) {
  return prisma.report.create({
    data: { ...data, reporterId, messageId },
  })
}

export async function createPostReport(
  data: CreateReportBody,
  reporterId: string,
  postId: string,
) {
  return prisma.report.create({
    data: { ...data, reporterId, postId },
  })
}

export async function createUserReport(
  data: CreateReportBody,
  reporterId: string,
  targetUserId: string,
) {
  return prisma.report.create({
    data: { ...data, reporterId, targetUserId },
  })
}

export async function findReports(query: ListReportsQuery) {
  const where: Prisma.ReportWhereInput = {}

  if (query.status) where.status = query.status
  if (query.reason) where.reason = query.reason
  if (query.reporterId) where.reporterId = query.reporterId

  if (query.targetType === 'EVENT') {
    where.eventId = query.eventId ?? { not: null }
  } else if (query.eventId) {
    where.eventId = query.eventId
  }

  if (query.targetType === 'COMMENT') {
    where.commentId = query.commentId ?? { not: null }
  } else if (query.commentId) {
    where.commentId = query.commentId
  }

  if (query.targetType === 'MESSAGE') {
    where.messageId = query.messageId ?? { not: null }
  } else if (query.messageId) {
    where.messageId = query.messageId
  }

  if (query.targetType === 'POST') {
    where.postId = query.postId ?? { not: null }
  } else if (query.postId) {
    where.postId = query.postId
  }

  if (query.targetType === 'USER') {
    where.targetUserId = query.targetUserId ?? { not: null }
  } else if (query.targetUserId) {
    where.targetUserId = query.targetUserId
  }

  return prisma.report.findMany({
    where,
    include: reportInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    skip: query.cursor ? 1 : undefined,
    cursor: query.cursor ? { id: query.cursor } : undefined,
  })
}

export async function findReportById(id: string) {
  return prisma.report.findUnique({
    where: { id },
    include: reportInclude,
  })
}

export async function updateReportResolution(
  id: string,
  reviewerId: string,
  data: ResolutionUpdate,
) {
  const isResolved = data.status.startsWith('RESOLVED')

  return prisma.report.update({
    where: { id },
    data: {
      status: data.status,
      reviewerId,
      resolutionNote: data.resolutionNote,
      resolvedAt: isResolved ? new Date() : null,
    },
    include: reportInclude,
  })
}

export async function deleteReportById(id: string) {
  return prisma.report.delete({ where: { id } })
}
