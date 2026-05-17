import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'

type TxClient = Prisma.TransactionClient

export async function findEventForFeatured(eventId: string) {
  return prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      authorId: true,
      date: true,
      author: { select: { isPremium: true } },
    },
  })
}

export async function findFeatureById(featureId: string) {
  return prisma.featuredEvent.findUnique({ where: { id: featureId } })
}

export async function findOverlappingActiveFeature(
  eventId: string,
  startsAt: Date,
  endsAt: Date,
) {
  return prisma.featuredEvent.findFirst({
    where: {
      eventId,
      canceledAt: null,
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
    },
    select: { id: true },
  })
}

export async function createFeaturedEventTx(
  tx: TxClient,
  data: { eventId: string; startsAt: Date; endsAt: Date; createdBy: string },
) {
  const feature = await tx.featuredEvent.create({ data })
  const now = new Date()
  if (feature.startsAt <= now && feature.endsAt >= now) {
    await tx.event.update({
      where: { id: feature.eventId },
      data: { isFeatured: true },
    })
  }
  return feature
}

export async function softCancelAndRecalculateTx(
  tx: TxClient,
  { featureId, eventId }: { featureId: string; eventId: string },
) {
  await tx.featuredEvent.update({
    where: { id: featureId },
    data: { canceledAt: new Date() },
  })

  const now = new Date()
  const remainingActive = await tx.featuredEvent.findFirst({
    where: {
      eventId,
      canceledAt: null,
      startsAt: { lte: now },
      endsAt: { gte: now },
    },
    select: { id: true },
  })

  await tx.event.update({
    where: { id: eventId },
    data: { isFeatured: remainingActive !== null },
  })
}

export { prisma }
