import type { Prisma } from '@prisma/client'
import {
  DEFAULT_DURATION_MS,
  type EventStatus,
  SOON_THRESHOLD_MS,
} from './event-lifecycle'

export function statusConditionFor(
  status: EventStatus,
  now: Date,
): Prisma.EventWhereInput {
  const soonBoundary = new Date(now.getTime() + SOON_THRESHOLD_MS)
  const pastBoundary = new Date(now.getTime() - DEFAULT_DURATION_MS)
  const notCanceled: Prisma.EventWhereInput = { canceledAt: null }

  switch (status) {
    case 'CANCELED':
      return { canceledAt: { not: null } }
    case 'PAST':
      return {
        AND: [
          notCanceled,
          {
            OR: [
              { endDate: { lte: now } },
              { AND: [{ endDate: null }, { date: { lte: pastBoundary } }] },
            ],
          },
        ],
      }
    case 'ONGOING':
      return {
        AND: [
          notCanceled,
          { date: { lte: now } },
          {
            OR: [
              { endDate: { gt: now } },
              { AND: [{ endDate: null }, { date: { gt: pastBoundary } }] },
            ],
          },
        ],
      }
    case 'SOON':
      return {
        AND: [notCanceled, { date: { gt: now, lte: soonBoundary } }],
      }
    case 'UPCOMING':
      return {
        AND: [notCanceled, { date: { gt: soonBoundary } }],
      }
  }
}

/**
 * WHERE clause base de ciclo de vida.
 * - Se `status` array é provido: traduz cada status para condição WHERE
 *   (OR entre os status). Se array não inclui 'CANCELED', cancelados ficam
 *   automaticamente fora.
 * - Se `status` não é provido:
 *   - Sempre exclui cancelados (canceledAt: null)
 *   - Se `includePast=false`, também exclui passados
 */
export function buildLifecycleWhere(opts: {
  includePast: boolean
  status?: EventStatus[]
  now: Date
}): Prisma.EventWhereInput {
  if (opts.status?.length) {
    return { OR: opts.status.map((s) => statusConditionFor(s, opts.now)) }
  }
  const base: Prisma.EventWhereInput = { canceledAt: null }
  if (opts.includePast) return base
  const pastBoundary = new Date(opts.now.getTime() - DEFAULT_DURATION_MS)
  return {
    AND: [
      base,
      {
        OR: [
          { endDate: { gt: opts.now } },
          { AND: [{ endDate: null }, { date: { gt: pastBoundary } }] },
        ],
      },
    ],
  }
}
