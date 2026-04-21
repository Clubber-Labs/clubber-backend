import type { ReactionType } from '@prisma/client'
import { prisma } from '../../lib/prisma'

export async function upsertEventReaction(
  userId: string,
  eventId: string,
  type: ReactionType,
) {
  const existing = await prisma.reaction.findFirst({
    where: { userId, eventId },
  })
  if (existing) {
    return prisma.reaction.update({
      where: { id: existing.id },
      data: { type },
    })
  }
  return prisma.reaction.create({ data: { userId, eventId, type } })
}

export async function upsertPostReaction(
  userId: string,
  postId: string,
  type: ReactionType,
) {
  const existing = await prisma.reaction.findFirst({
    where: { userId, postId },
  })
  if (existing) {
    return prisma.reaction.update({
      where: { id: existing.id },
      data: { type },
    })
  }
  return prisma.reaction.create({ data: { userId, postId, type } })
}

export async function deleteEventReaction(userId: string, eventId: string) {
  return prisma.reaction.delete({
    where: { userId_eventId: { userId, eventId } },
  })
}

export async function deletePostReaction(userId: string, postId: string) {
  return prisma.reaction.delete({
    where: { userId_postId: { userId, postId } },
  })
}

export async function findEventReaction(userId: string, eventId: string) {
  return prisma.reaction.findUnique({
    where: { userId_eventId: { userId, eventId } },
  })
}

export async function findPostReaction(userId: string, postId: string) {
  return prisma.reaction.findUnique({
    where: { userId_postId: { userId, postId } },
  })
}
