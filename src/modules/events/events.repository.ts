import type { Prisma } from '@prisma/client'
import { buildLifecycleWhere } from '../../lib/event-filters'
import {
  computeEventStatus,
  type EventStatus,
} from '../../lib/event-lifecycle'
import { prisma } from '../../lib/prisma'
import {
  type Bbox,
  findEventIdsByDistance,
  findEventIdsInBbox,
  findEventIdsWithinRadius,
} from '../../lib/spatial'
import {
  buildCommentInclude,
  commentAuthorSelect,
} from '../comments/comments.repository'
import type {
  CreateEventBody,
  ListEventsQuery,
  MapEventsQuery,
  UpdateEventBody,
} from './events.schema'

const authorSelect = commentAuthorSelect

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
      include: buildCommentInclude(viewerId),
    },
    images: {
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: eventImageSelect,
    },
    ...(viewerId && {
      reactions: {
        where: { userId: viewerId },
        select: { id: true },
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
      include: {
        author: { select: typeof authorSelect }
        _count: { select: { reactions: true } }
        reactions: { select: { id: true } }
      }
    }
    images: { select: typeof eventImageSelect }
    reactions: { select: { id: true } }
    attendances: { select: { type: true } }
  }
}>

type AuthorPayload = Prisma.UserGetPayload<{ select: typeof authorSelect }>

export type NormalizedComment = {
  id: string
  content: string
  createdAt: Date
  author: AuthorPayload
  reactionsCount: number
  userLiked: boolean
}

export type NormalizedEvent = Omit<
  PrismaEvent,
  'reactions' | 'attendances' | 'comments'
> & {
  recentComments: NormalizedComment[]
  userLiked: boolean
  userAttendance: string | null
  status: EventStatus
}

function normalizeEvent(
  event: PrismaEvent,
  viewerId?: string,
  now: Date = new Date(),
): NormalizedEvent {
  const { reactions, attendances, comments, ...rest } = event

  return {
    ...rest,
    recentComments: (comments ?? []).map((c) => ({
      id: c.id,
      content: c.content,
      createdAt: c.createdAt,
      author: c.author,
      reactionsCount: c._count.reactions,
      userLiked: !!(viewerId && c.reactions?.length),
    })),
    userLiked: !!(viewerId && reactions?.length),
    userAttendance:
      viewerId && attendances?.length ? attendances[0].type : null,
    status: computeEventStatus(event, now),
  }
}

export async function findPublicEvents(
  filters: Pick<
    ListEventsQuery,
    | 'category'
    | 'status'
    | 'includePast'
    | 'dateFrom'
    | 'dateTo'
    | 'nearLat'
    | 'nearLng'
    | 'radiusKm'
    | 'orderBy'
  >,
  limit: number,
  cursor?: string,
  viewerId?: string,
  now: Date = new Date(),
) {
  const KNN_OVERFETCH = 20
  const KNN_OVERFETCH_CAP = 1000

  let spatialIdFilter: string[] | undefined

  if (filters.orderBy === 'distance' && filters.nearLat !== undefined && filters.nearLng !== undefined) {
    spatialIdFilter = await findEventIdsByDistance(
      { latitude: filters.nearLat, longitude: filters.nearLng },
      Math.min(limit * KNN_OVERFETCH, KNN_OVERFETCH_CAP),
      filters.radiusKm,
    )
    if (spatialIdFilter.length === 0) return []
  } else if (filters.radiusKm !== undefined && filters.nearLat !== undefined && filters.nearLng !== undefined) {
    spatialIdFilter = await findEventIdsWithinRadius(
      { latitude: filters.nearLat, longitude: filters.nearLng },
      filters.radiusKm,
    )
    if (spatialIdFilter.length === 0) return []
  }

  const events = (await prisma.event.findMany({
    where: {
      isPublic: true,
      ...buildLifecycleWhere({
        includePast: filters.includePast ?? false,
        status: filters.status,
        now,
      }),
      ...(spatialIdFilter && { id: { in: spatialIdFilter } }),
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
    take: filters.orderBy === 'distance' ? undefined : limit,
    ...(cursor && filters.orderBy !== 'distance' && { skip: 1, cursor: { id: cursor } }),
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
    include: buildEventIncludes(viewerId),
  })) as unknown as PrismaEvent[]

  const ordered =
    filters.orderBy === 'distance' && spatialIdFilter
      ? spatialIdFilter
          .map((id) => events.find((e) => e.id === id))
          .filter((e): e is PrismaEvent => e !== undefined)
          .slice(0, limit)
      : events

  return ordered.map((e) => normalizeEvent(e, viewerId, now))
}

export async function findEventsByAuthor(
  authorId: string,
  limit: number,
  viewerId?: string,
  cursor?: string,
  now: Date = new Date(),
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

  return events.map((e) => normalizeEvent(e, viewerId, now))
}

export async function findEventAccess(id: string) {
  return prisma.event.findUnique({
    where: { id },
    select: {
      id: true,
      isPublic: true,
      authorId: true,
      date: true,
      endDate: true,
    },
  })
}

export async function findEventById(
  id: string,
  viewerId?: string,
  now: Date = new Date(),
) {
  const event = (await prisma.event.findUnique({
    where: { id },
    include: buildEventIncludes(viewerId),
  })) as unknown as PrismaEvent | null

  if (!event) return null
  return normalizeEvent(event, viewerId, now)
}

export type MapEventPoint = {
  id: string
  latitude: number
  longitude: number
  weight: number
}

/**
 * Boost aditivo no peso do heatmap por status do evento.
 * Garante que ONGOING sem confirmados ainda apareça com calor visível,
 * e que SOON tenha leve destaque sobre UPCOMING distante.
 */
const STATUS_HEATMAP_BOOST: Record<EventStatus, number> = {
  ONGOING: 20,
  SOON: 5,
  UPCOMING: 0,
  PAST: 0,
  CANCELED: 0,
}

const MAP_BBOX_FETCH_CAP = 2000
const MAP_RESPONSE_CAP = 500

/**
 * Eventos para o heatmap dentro do bbox.
 * Peso = 2 * CONFIRMED + 1 * INTERESTED + STATUS_HEATMAP_BOOST[status].
 * Mobile renderiza heatmap a partir desses pontos brutos.
 */
export async function findEventsForMap(
  query: MapEventsQuery,
  now: Date = new Date(),
): Promise<MapEventPoint[]> {
  const bbox: Bbox = {
    north: query.bboxNorth,
    south: query.bboxSouth,
    east: query.bboxEast,
    west: query.bboxWest,
  }

  const idsInBbox = await findEventIdsInBbox(bbox, MAP_BBOX_FETCH_CAP)
  if (idsInBbox.length === 0) return []

  const events = await prisma.event.findMany({
    where: {
      id: { in: idsInBbox },
      isPublic: true,
      ...buildLifecycleWhere({
        includePast: false,
        status: query.status,
        now,
      }),
      ...(query.category && query.category.length > 0
        ? { category: { in: query.category } }
        : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            date: {
              ...(query.dateFrom && { gte: new Date(query.dateFrom) }),
              ...(query.dateTo && { lte: new Date(query.dateTo) }),
            },
          }
        : {}),
    },
    select: {
      id: true,
      latitude: true,
      longitude: true,
      date: true,
      endDate: true,
      canceledAt: true,
    },
  })
  if (events.length === 0) return []

  const eventIds = events.map((e) => e.id)
  const grouped = await prisma.eventAttendance.groupBy({
    by: ['eventId', 'type'],
    where: { eventId: { in: eventIds } },
    _count: { _all: true },
  })

  const engagement = new Map<string, number>()
  for (const row of grouped) {
    const w =
      row.type === 'CONFIRMED' ? 2 : row.type === 'INTERESTED' ? 1 : 0
    engagement.set(
      row.eventId,
      (engagement.get(row.eventId) ?? 0) + row._count._all * w,
    )
  }

  const points = events.map((e) => {
    const status = computeEventStatus(e, now)
    return {
      id: e.id,
      latitude: e.latitude,
      longitude: e.longitude,
      weight: (engagement.get(e.id) ?? 0) + STATUS_HEATMAP_BOOST[status],
    }
  })
  points.sort((a, b) => b.weight - a.weight)
  return points.slice(0, MAP_RESPONSE_CAP)
}

export async function createEvent(
  data: CreateEventBody & { authorId: string },
) {
  return prisma.event.create({
    data: {
      ...data,
      date: new Date(data.date),
      ...(data.endDate && { endDate: new Date(data.endDate) }),
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
