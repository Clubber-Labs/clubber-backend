import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'

export async function createEventReaction(userId: string, eventId: string) {
  try {
    return await prisma.reaction.create({ data: { userId, eventId } })
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      return prisma.reaction.findUniqueOrThrow({
        where: { userId_eventId: { userId, eventId } },
      })
    }
    throw e
  }
}

export async function createPostReaction(userId: string, postId: string) {
  try {
    return await prisma.reaction.create({ data: { userId, postId } })
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      return prisma.reaction.findUniqueOrThrow({
        where: { userId_postId: { userId, postId } },
      })
    }
    throw e
  }
}

export async function createCommentReaction(userId: string, commentId: string) {
  try {
    return await prisma.commentReaction.create({
      data: { userId, commentId },
    })
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      return prisma.commentReaction.findUniqueOrThrow({
        where: { userId_commentId: { userId, commentId } },
      })
    }
    throw e
  }
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

export async function deleteCommentReaction(userId: string, commentId: string) {
  return prisma.commentReaction.delete({
    where: { userId_commentId: { userId, commentId } },
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

export async function findCommentReaction(userId: string, commentId: string) {
  return prisma.commentReaction.findUnique({
    where: { userId_commentId: { userId, commentId } },
  })
}
