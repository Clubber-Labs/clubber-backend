import { prisma } from '../../lib/prisma'
import {
  createFeaturedEventTx,
  findEventForFeatured,
  findFeatureById,
  findOverlappingActiveFeature,
  softCancelAndRecalculateTx,
} from './featured-events.repository'
import type { CreateFeaturedEventBody } from './featured-events.schema'

const START_AT_TOLERANCE_MS = 5_000

export async function addFeaturedEvent(
  eventId: string,
  body: CreateFeaturedEventBody,
  requesterId: string,
) {
  const event = await findEventForFeatured(eventId)
  if (!event) throw { statusCode: 404, message: 'Evento não encontrado' }

  if (event.authorId !== requesterId) {
    throw {
      statusCode: 403,
      message: 'Apenas o autor do evento pode destacá-lo',
    }
  }

  if (!event.author.isPremium) {
    throw {
      statusCode: 403,
      message: 'Apenas usuários premium podem destacar eventos',
    }
  }

  const now = Date.now()
  if (body.startsAt.getTime() < now - START_AT_TOLERANCE_MS) {
    throw {
      statusCode: 400,
      message: 'startsAt deve ser igual ou posterior ao momento atual',
    }
  }

  if (body.endsAt > event.date) {
    throw {
      statusCode: 400,
      message: 'endsAt não pode ser posterior à data do evento',
    }
  }

  const overlap = await findOverlappingActiveFeature(
    eventId,
    body.startsAt,
    body.endsAt,
  )
  if (overlap) {
    throw {
      statusCode: 409,
      message: 'Já existe um destaque ativo neste período',
    }
  }

  return prisma.$transaction((tx) =>
    createFeaturedEventTx(tx, {
      eventId,
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      createdBy: requesterId,
    }),
  )
}

export async function cancelFeaturedEvent(
  eventId: string,
  featureId: string,
  requesterId: string,
) {
  const event = await findEventForFeatured(eventId)
  if (!event) throw { statusCode: 404, message: 'Evento não encontrado' }

  if (event.authorId !== requesterId) {
    throw {
      statusCode: 403,
      message: 'Apenas o autor do evento pode cancelar destaques',
    }
  }

  const feature = await findFeatureById(featureId)
  if (!feature || feature.eventId !== eventId) {
    throw { statusCode: 404, message: 'Destaque não encontrado' }
  }

  if (feature.canceledAt !== null) {
    throw { statusCode: 409, message: 'Destaque já cancelado' }
  }

  await prisma.$transaction((tx) =>
    softCancelAndRecalculateTx(tx, { featureId, eventId }),
  )
}
