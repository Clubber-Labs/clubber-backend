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
