import { env } from '../../lib/env'
import {
  createFeaturedEventWithQuota,
  findEventForFeatured,
  findFeatureById,
  findOverlappingActiveFeature,
  softCancelFeaturedEvent,
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

  // Teto de duração: a quota mensal conta destaques (não tempo), então sem isto
  // um único destaque poderia durar até a data do evento gastando só 1 crédito.
  const maxDurationMs = env.PROMOTION_MAX_DURATION_DAYS * 24 * 60 * 60 * 1000
  if (body.endsAt.getTime() - body.startsAt.getTime() > maxDurationMs) {
    throw {
      statusCode: 400,
      message: `O destaque pode durar no máximo ${env.PROMOTION_MAX_DURATION_DAYS} dias`,
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

  try {
    return await createFeaturedEventWithQuota(
      {
        eventId,
        startsAt: body.startsAt,
        endsAt: body.endsAt,
        createdBy: requesterId,
      },
      env.PROMOTION_MONTHLY_LIMIT,
    )
  } catch (err) {
    // Safety-net: dois POSTs concorrentes podem passar pelo check otimista
    // acima e chegar aqui simultaneamente. A constraint de exclusão no DB
    // (featured_events_no_overlap_active) garante a invariante temporal,
    // e aqui convertemos o erro do Postgres no 409 esperado.
    if (
      err !== null &&
      typeof err === 'object' &&
      'message' in err &&
      typeof err.message === 'string' &&
      err.message.includes('featured_events_no_overlap_active')
    ) {
      throw {
        statusCode: 409,
        message: 'Já existe um destaque ativo neste período',
      }
    }
    throw err
  }
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

  await softCancelFeaturedEvent({ featureId, eventId })
}
