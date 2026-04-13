import { prisma } from '../../lib/prisma'
import type { CreateEventBody, UpdateEventBody } from './events.schema'

export async function findAllPublicEvents() {
  return prisma.event.findMany({
    where: { isPublic: true },
    include: { author: { select: { id: true, name: true, lastname: true } } },
    orderBy: { date: 'asc' },
  })
}

export async function findEventById(id: string) {
  return prisma.event.findUnique({
    where: { id },
    include: { author: { select: { id: true, name: true, lastname: true } } },
  })
}

export async function createEvent(
  data: CreateEventBody & { authorId: string },
) {
  return prisma.event.create({ 
    data:{
      ...data,
      date: new Date(data.date)
    }
  })
}

export async function updateEvent(id: string, data: UpdateEventBody) {
  return prisma.event.update({ where: { id }, data })
}

export async function deleteEvent(id: string) {
  return prisma.event.delete({ where: { id } })
}
