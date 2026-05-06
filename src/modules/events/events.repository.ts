import type { Prisma } from '@prisma/client'
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

const eventImageSelect = {
  id: true,
  url: true,
  format: true,
  size: true,
  order: true,
} as const

function buildEventIncludes(viewerId?: string): Prisma.EventInclude {
  return {
    author: { select: authorSelect },
    _count: {
      select: { attendances: true, reactions: true, comments: true },
    },
    comments: {
      orderBy: { createdAt: 'desc' },
      take: 2,
      include: { author: { select: authorSelect } },
    },
    images: {
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: eventImageSelect,
    },
    ...(viewerId && {
      reactions: {
        where: { userId: viewerId },
        select: { type: true },
        take: 1,
      },
      attendances: {
        where: { userId: viewerId },
        select: { type: true },
        take: 1,
      },
    }),
  }
}

type PrismaEvent = Prisma.EventGetPayload<{
  include: {
    author: { select: typeof authorSelect }
    _count: { select: { attendances: true; reactions: true; comments: true } }
    comments: {
      include: { author: { select: typeof authorSelect } }
    }
    images: { select: typeof eventImageSelect }
    reactions: { select: { type: true } }
    attendances: { select: { type: true } }
  }
}>

export type NormalizedEvent = Omit<
  PrismaEvent,
  'reactions' | 'attendances' | 'comments'
> & {
  recentComments: {
    id: string
    content: string
    createdAt: Date
    author: { id: string; name: string; lastname: string; username: string }
  }[]
  userReaction: string | null
  userAttendance: string | null
}

function normalizeEvent(
  event: PrismaEvent,
  viewerId?: string,
): NormalizedEvent {
  const { reactions, attendances, comments, ...rest } = event

  return {
    ...rest,
    recentComments: (comments ?? []).map((c) => ({
      id: c.id,
      content: c.content,
      createdAt: c.createdAt,
      author: c.author,
    })),
    userReaction: viewerId && reactions?.length ? reactions[0].type : null,
    userAttendance:
      viewerId && attendances?.length ? attendances[0].type : null,
  }
}

export async function findPublicEvents(
  filters: Pick<ListEventsQuery, 'category' | 'dateFrom' | 'dateTo'>,
  limit: number,
  cursor?: string,
  viewerId?: string,
) {
  const events = (await prisma.event.findMany({
    where: {
      isPublic: true,
      ...(filters.category && filters.category.length > 0
        ? { category: { in: filters.category } }
        : {}),
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
    include: buildEventIncludes(viewerId),
  })) as unknown as PrismaEvent[]

  return events.map((e) => normalizeEvent(e, viewerId))
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
  const events = (await prisma.event.findMany({
    where,
    take: limit,
    ...(cursor && { skip: 1, cursor: { id: cursor } }),
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
    include: buildEventIncludes(viewerId),
  })) as unknown as PrismaEvent[]

  return events.map((e) => normalizeEvent(e, viewerId))
}

export async function findEventAccess(id: string) {
  return prisma.event.findUnique({
    where: { id },
    select: { id: true, isPublic: true, authorId: true },
  })
}

export async function findEventById(id: string, viewerId?: string) {
  const event = (await prisma.event.findUnique({
    where: { id },
    include: buildEventIncludes(viewerId),
  })) as unknown as PrismaEvent | null

  if (!event) return null
  return normalizeEvent(event, viewerId)
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

export async function createEventImage(
  eventId: string,
  data: Omit<Prisma.EventImageUncheckedCreateInput, 'eventId' | 'order'>,
) {
  const agg = await prisma.eventImage.aggregate({
    where: { eventId },
    _max: { order: true },
  })
  const nextOrder = (agg._max.order ?? -1) + 1
  return prisma.eventImage.create({ data: { ...data, eventId, order: nextOrder } })
}

export async function findEventImageKeys(eventId: string) {
  return prisma.eventImage.findMany({
    where: { eventId },
    select: { key: true },
  })
}
