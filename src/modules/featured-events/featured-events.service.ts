import { env } from '../../lib/env'
import { AppError } from '../../lib/errors/app-error'
import { enqueuePromotionStarted } from '../notifications/notification-queue'
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
  if (!event) throw new AppError(404, 'EVENT_NOT_FOUND')

  if (event.authorId !== requesterId) {
    throw new AppError(403, 'NOT_EVENT_AUTHOR')
  }

  if (!event.author.isPremium) {
    throw new AppError(403, 'PREMIUM_REQUIRED')
  }

  const now = Date.now()
  if (body.startsAt.getTime() < now - START_AT_TOLERANCE_MS) {
    throw new AppError(400, 'STARTS_AT_IN_PAST')
  }

  if (body.endsAt > event.date) {
    throw new AppError(400, 'ENDS_AT_AFTER_EVENT_DATE')
  }

  // Teto de duração: a quota mensal conta destaques (não tempo), então sem isto
  // um único destaque poderia durar até a data do evento gastando só 1 crédito.
  const maxDurationMs = env.PROMOTION_MAX_DURATION_DAYS * 24 * 60 * 60 * 1000
  if (body.endsAt.getTime() - body.startsAt.getTime() > maxDurationMs) {
    throw new AppError(400, 'PROMOTION_TOO_LONG', undefined, {
      maxDays: env.PROMOTION_MAX_DURATION_DAYS,
    })
  }

  const overlap = await findOverlappingActiveFeature(
    eventId,
    body.startsAt,
    body.endsAt,
  )
  if (overlap) {
    throw new AppError(409, 'PROMOTION_OVERLAP')
  }

  try {
    const feature = await createFeaturedEventWithQuota(
      {
        eventId,
        startsAt: body.startsAt,
        endsAt: body.endsAt,
        createdBy: requesterId,
      },
      env.PROMOTION_MONTHLY_LIMIT,
    )
    // Janela já aberta: o alcance pago sai agora. Destaque agendado é
    // enfileirado pelo reconciler no tick em que a janela abrir.
    const startedAt = Date.now()
    if (
      feature.startsAt.getTime() <= startedAt &&
      feature.endsAt.getTime() >= startedAt
    ) {
      await enqueuePromotionStarted(eventId)
    }
    return feature
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
      throw new AppError(409, 'PROMOTION_OVERLAP')
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
  if (!event) throw new AppError(404, 'EVENT_NOT_FOUND')

  if (event.authorId !== requesterId) {
    throw new AppError(403, 'NOT_EVENT_AUTHOR')
  }

  const feature = await findFeatureById(featureId)
  if (!feature || feature.eventId !== eventId) {
    throw new AppError(404, 'PROMOTION_NOT_FOUND')
  }

  if (feature.canceledAt !== null) {
    throw new AppError(409, 'PROMOTION_ALREADY_CANCELED')
  }

  await softCancelFeaturedEvent({ featureId, eventId })
}
