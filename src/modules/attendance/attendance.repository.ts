import type { AttendanceType } from '@prisma/client'
import { prisma } from '../../lib/prisma'

export async function findAttendanceByUserAndEvent(
  userId: string,
  eventId: string,
) {
  return prisma.eventAttendance.findUnique({
    where: {
      userId_eventId: { userId, eventId },
    },
  })
}

export async function createAttendance(
  userId: string,
  eventId: string,
  type: AttendanceType,
) {
  return prisma.eventAttendance.create({
    data: { userId, eventId, type },
  })
}

export async function deleteAttendance(userId: string, eventId: string) {
  return prisma.eventAttendance.delete({
    where: {
      userId_eventId: { userId, eventId },
    },
  })
}

export async function findAttendancesByEvent(eventId: string) {
  return prisma.eventAttendance.findMany({
    where: { eventId },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          lastname: true,
          username: true,
        },
      },
    },
  })
}
