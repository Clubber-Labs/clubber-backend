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

/** 1º dia do mês (UTC) — chave da quota mensal de promoções. */
export function promotionPeriodFor(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

// Consome 1 da quota mensal de promoções, atomicamente, DENTRO da transação
// de criação do destaque. Upsert + increment serializa pelo PK (userId,period);
// exceder o limite lança 429 e o rollback da transação desfaz o incremento
// (tentativa rejeitada não consome). Cancelar destaque NÃO devolve quota.
export async function consumePromotionQuotaTx(
  tx: TxClient,
  userId: string,
  limit: number,
  now: Date = new Date(),
) {
  const period = promotionPeriodFor(now)
  const usage = await tx.eventPromotionUsage.upsert({
    where: { userId_period: { userId, period } },
    create: { userId, period, count: 1 },
    update: { count: { increment: 1 } },
  })
  if (usage.count > limit) {
    throw {
      statusCode: 429,
      message: 'Limite mensal de promoções atingido',
    }
  }
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

async function softCancelAndRecalculateTx(
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

// Cria o destaque consumindo a quota mensal na MESMA transação (atômico): se a
// quota estoura (429) o rollback desfaz o incremento. A fronteira de transação
// mora aqui (e não no service) — o service não toca Prisma.
export async function createFeaturedEventWithQuota(
  data: { eventId: string; startsAt: Date; endsAt: Date; createdBy: string },
  monthlyLimit: number,
) {
  return prisma.$transaction(async (tx) => {
    await consumePromotionQuotaTx(tx, data.createdBy, monthlyLimit)
    return createFeaturedEventTx(tx, data)
  })
}

// Cancela o destaque e recalcula Event.isFeatured numa transação.
export async function softCancelFeaturedEvent(params: {
  featureId: string
  eventId: string
}) {
  await prisma.$transaction((tx) => softCancelAndRecalculateTx(tx, params))
}
