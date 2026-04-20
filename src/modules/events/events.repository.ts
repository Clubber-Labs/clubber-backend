import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import type {
  CreateEventBody,
  ListEventsQuery,
  UpdateEventBody,
} from './events.schema'

const authorSelect = {
  id: true,
  name: true,
  lastname: true,
  username: true,
} as const

export async function findPublicEvents(
  filters: Pick<ListEventsQuery, 'category' | 'dateFrom' | 'dateTo'>,
  limit: number,
  cursor?: string,
) {
  return prisma.event.findMany({
    where: {
      isPublic: true,
      ...(filters.category && { category: filters.category }),
      ...(filters.dateFrom || filters.dateTo
        ? {
          date: {
            ...(filters.dateFrom && { gte: new Date(filters.dateFrom) }),
            ...(filters.dateTo && { lte: new Date(filters.dateTo) }),
          },
        }
        : {}),
    },
    take: limit,
    ...(cursor && { skip: 1, cursor: { id: cursor } }),
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
    include: {
      author: { select: authorSelect },
      _count: {
        select: { attendances: true, reactions: true, comments: true },
      },
    },
  })
}

/** @deprecated Use findPublicEvents */
export async function findAllPublicEvents() {
  return prisma.event.findMany({
    where: { isPublic: true },
    include: { author: { select: authorSelect } },
    orderBy: { date: 'asc' },
  })
}

export async function findEventsByAuthor(
  authorId: string,
  limit: number,
  viewerId?: string,
  cursor?: string,
) {
  const where: Prisma.EventWhereInput = {
    authorId,
    ...(viewerId !== authorId && { isPublic: true }),
  }
  return prisma.event.findMany({
    where,
    take: limit,
    ...(cursor && { skip: 1, cursor: { id: cursor } }),
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
    include: {
      author: { select: authorSelect },
      _count: {
        select: { attendances: true, reactions: true, comments: true },
      },
    },
  })
}

export async function findEventById(id: string) {
  return prisma.event.findUnique({
    where: { id },
    include: {
      author: { select: authorSelect },
      _count: { select: { attendances: true, reactions: true, comments: true } }
    },
  })
}

export async function createEvent(
  data: CreateEventBody & { authorId: string },
) {
  return prisma.event.create({
    data: {
      ...data,
      date: new Date(data.date),
    },
  })
}

export async function updateEvent(id: string, data: UpdateEventBody) {
  return prisma.event.update({ where: { id }, data })
}

export async function deleteEvent(id: string) {
  return prisma.event.delete({ where: { id } })
}
