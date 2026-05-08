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
  avatarUrl: true,
} as const

const eventImageSelect = {
  id: true,
  url: true,
  format: true,
  size: true,
  order: true,
} as const

function buildSharedIncludes(): Prisma.EventInclude {
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
  }
}

function buildEventIncludes(viewerId?: string): Prisma.EventInclude {
  return {
    ...buildSharedIncludes(),
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

type PrismaSharedEvent = Prisma.EventGetPayload<{
  include: {
    author: { select: typeof authorSelect }
    _count: { select: { attendances: true; reactions: true; comments: true } }
    comments: {
      include: { author: { select: typeof authorSelect } }
    }
    images: { select: typeof eventImageSelect }
  }
}>

type PrismaEvent = PrismaSharedEvent & {
  reactions?: { type: string }[]
  attendances?: { type: string }[]
}

type AuthorPayload = Prisma.UserGetPayload<{ select: typeof authorSelect }>

export type SharedEvent = Omit<PrismaSharedEvent, 'comments'> & {
  recentComments: {
    id: string
    content: string
    createdAt: Date
    author: AuthorPayload
  }[]
}

export type NormalizedEvent = SharedEvent & {
  userReaction: string | null
  userAttendance: string | null
}

function normalizeShared(event: PrismaSharedEvent): SharedEvent {
  const { comments, ...rest } = event
  return {
    ...rest,
    recentComments: (comments ?? []).map((c) => ({
      id: c.id,
      content: c.content,
      createdAt: c.createdAt,
      author: c.author,
    })),
  }
}

function normalizeEvent(
  event: PrismaEvent,
  viewerId?: string,
): NormalizedEvent {
  const shared = normalizeShared(event)
  return {
    ...shared,
    userReaction:
      viewerId && event.reactions?.length ? event.reactions[0].type : null,
    userAttendance:
      viewerId && event.attendances?.length ? event.attendances[0].type : null,
  }
}

export async function findPublicEvents(
  filters: Pick<ListEventsQuery, 'category' | 'dateFrom' | 'dateTo'>,
  limit: number,
  cursor?: string,
): Promise<SharedEvent[]> {
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
    include: buildSharedIncludes(),
  })) as unknown as PrismaSharedEvent[]

  return events.map(normalizeShared)
}

export type ViewerEventState = {
  reaction: string | null
  attendance: string | null
}

export async function findViewerStatesForEvents(
  viewerId: string,
  eventIds: string[],
): Promise<Map<string, ViewerEventState>> {
  if (eventIds.length === 0) return new Map()

  const [reactions, attendances] = await Promise.all([
    prisma.reaction.findMany({
      where: { userId: viewerId, eventId: { in: eventIds } },
      select: { eventId: true, type: true },
    }),
    prisma.eventAttendance.findMany({
      where: { userId: viewerId, eventId: { in: eventIds } },
      select: { eventId: true, type: true },
    }),
  ])

  const map = new Map<string, ViewerEventState>(
    eventIds.map((id) => [id, { reaction: null, attendance: null }]),
  )
  for (const r of reactions) {
    if (r.eventId) {
      const entry = map.get(r.eventId)
      if (entry) entry.reaction = r.type
    }
  }
  for (const a of attendances) {
    const entry = map.get(a.eventId)
    if (entry) entry.attendance = a.type
  }
  return map
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
  return prisma.eventImage.create({
    data: { ...data, eventId, order: nextOrder },
  })
}

export async function findEventImageKeys(eventId: string) {
  return prisma.eventImage.findMany({
    where: { eventId },
    select: { key: true },
  })
}
