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

/**
 * Fim efetivo do evento >= now - windowMs. Mantém eventos futuros/ongoing e os
 * que terminaram há no máximo `windowMs` (regra das 48h do mapa). Quando
 * `endDate` é null, o fim efetivo é `date + DEFAULT_DURATION_MS`, então o piso
 * para `date` recua a duração padrão.
 */
export function recentEndWhere(
  now: Date,
  windowMs: number,
): Prisma.EventWhereInput {
  const endFloor = new Date(now.getTime() - windowMs)
  const startFloor = new Date(now.getTime() - windowMs - DEFAULT_DURATION_MS)
  return {
    OR: [
      { endDate: { gte: endFloor } },
      { AND: [{ endDate: null }, { date: { gte: startFloor } }] },
    ],
  }
}

/**
 * WHERE de ciclo de vida para o mapa/busca: exclui cancelados e limita os
 * eventos passados à janela recente (`recentPastMs`). Se `status[]` vier,
 * aplica as condições de status — mas o teto de passado recente continua
 * valendo (mesmo `status=PAST` não traz eventos antigos demais).
 */
export function buildMapLifecycleWhere(opts: {
  status?: EventStatus[]
  now: Date
  recentPastMs: number
}): Prisma.EventWhereInput {
  const recent = recentEndWhere(opts.now, opts.recentPastMs)
  if (opts.status?.length) {
    return {
      AND: [
        recent,
        { OR: opts.status.map((s) => statusConditionFor(s, opts.now)) },
      ],
    }
  }
  return { AND: [{ canceledAt: null }, recent] }
}
