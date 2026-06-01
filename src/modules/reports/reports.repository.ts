import { prisma } from '../../lib/prisma'
import type { CreateReportBody } from './reports.schema'

export async function findEventById(eventId: string) {
  return prisma.event.findUnique({ where: { id: eventId } })
}

export async function findCommentById(commentId: string) {
  return prisma.comment.findUnique({ where: { id: commentId } })
}

export async function findExistingEventReport(
  reporterId: string,
  eventId: string,
) {
  return prisma.report.findFirst({
    where: { reporterId, eventId, status: 'PENDING' },
  })
}

export async function findExistingCommentReport(
  reporterId: string,
  commentId: string,
) {
  return prisma.report.findFirst({
    where: { reporterId, commentId, status: 'PENDING' },
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

export async function findMessageById(messageId: string) {
  return prisma.message.findUnique({
    where: { id: messageId },
    select: { id: true, conversationId: true, senderId: true },
  })
}

/** Participação ativa do reporter na conversa da mensagem (autorização). */
export async function findActiveConversationParticipant(
  conversationId: string,
  userId: string,
) {
  return prisma.conversationParticipant.findFirst({
    where: { conversationId, userId, leftAt: null },
    select: { userId: true },
  })
}

export async function findExistingMessageReport(
  reporterId: string,
  messageId: string,
) {
  return prisma.report.findFirst({
    where: { reporterId, messageId, status: 'PENDING' },
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
