import { randomBytes } from 'node:crypto'
import type { EventInviteLink } from '@prisma/client'
import { env } from '../../lib/env'
import { AppError } from '../../lib/errors/app-error'
import { resolveEndDate } from '../../lib/event-lifecycle'
import { isBlockedEitherWay } from '../blocks/blocks.repository'
import { findInvite } from '../event-invites/event-invites.repository'
import {
  acceptLink,
  findEventForLink,
  findLinkById,
  findLinkByToken,
  findLinksByEvent,
  findOrCreateActiveLink,
  revokeLink,
} from './event-invite-links.repository'

function buildInviteUrl(token: string) {
  return `${env.SHARE_BASE_URL}/e/${token}`
}

function serializeLink(link: EventInviteLink) {
  return {
    id: link.id,
    token: link.token,
    url: buildInviteUrl(link.token),
    expiresAt: link.expiresAt,
    revokedAt: link.revokedAt,
    usesCount: link.usesCount,
    createdAt: link.createdAt,
  }
}

async function findAuthoredEvent(eventId: string, requesterId: string) {
  const event = await findEventForLink(eventId)
  if (!event) {
    throw new AppError(404, 'EVENT_NOT_FOUND')
  }
  if (event.authorId !== requesterId) {
    throw new AppError(403, 'NOT_EVENT_AUTHOR')
  }
  return event
}

export async function createInviteLink(eventId: string, requesterId: string) {
  const event = await findAuthoredEvent(eventId, requesterId)
  if (event.canceledAt) {
    throw new AppError(400, 'EVENT_CANCELED')
  }

  const now = new Date()
  const expiresAt = resolveEndDate(event.date, event.endDate)
  if (expiresAt <= now) {
    throw new AppError(400, 'EVENT_ENDED')
  }

  const { link, created } = await findOrCreateActiveLink(
    eventId,
    {
      createdById: requesterId,
      token: randomBytes(16).toString('base64url'),
      expiresAt,
    },
    now,
  )
  return { link: serializeLink(link), created }
}

export async function listInviteLinks(eventId: string, requesterId: string) {
  await findAuthoredEvent(eventId, requesterId)
  const links = await findLinksByEvent(eventId)
  return links.map(serializeLink)
}

export async function revokeInviteLink(
  eventId: string,
  linkId: string,
  requesterId: string,
) {
  await findAuthoredEvent(eventId, requesterId)
  const link = await findLinkById(linkId)
  if (!link || link.eventId !== eventId) {
    throw new AppError(404, 'INVITE_LINK_NOT_FOUND')
  }
  if (!link.revokedAt) {
    await revokeLink(linkId, new Date())
  }
}

type LinkWithEvent = NonNullable<Awaited<ReturnType<typeof findLinkByToken>>>

/**
 * Valida o token e devolve o link com o evento. Bloqueio entre viewer e autor
 * responde 404 (não 403) de propósito: um link vazado não deve confirmar a um
 * bloqueado que o evento existe.
 */
async function resolveLink(
  token: string,
  viewerId?: string,
): Promise<LinkWithEvent> {
  const link = await findLinkByToken(token)
  if (!link) {
    throw new AppError(404, 'INVITE_LINK_NOT_FOUND')
  }
  if (
    viewerId &&
    viewerId !== link.event.authorId &&
    (await isBlockedEitherWay(link.event.authorId, viewerId))
  ) {
    throw new AppError(404, 'INVITE_LINK_NOT_FOUND')
  }
  if (link.event.canceledAt) {
    throw new AppError(410, 'EVENT_CANCELED')
  }
  if (link.revokedAt) {
    throw new AppError(410, 'INVITE_LINK_REVOKED')
  }
  if (link.expiresAt <= new Date()) {
    throw new AppError(410, 'INVITE_LINK_EXPIRED')
  }
  return link
}

async function viewerHasAccess(
  link: LinkWithEvent,
  viewerId?: string,
): Promise<boolean> {
  if (link.event.isPublic) return true
  if (!viewerId) return false
  if (viewerId === link.event.authorId) return true
  return (await findInvite(link.event.id, viewerId)) !== null
}

export async function getInviteLinkPreview(token: string, viewerId?: string) {
  const link = await resolveLink(token, viewerId)
  const { event } = link

  // Preview enxuto de propósito: sem endereço/coordenadas — localização exata
  // só depois de entrar no evento.
  return {
    event: {
      id: event.id,
      title: event.title,
      description: event.description,
      date: event.date,
      endDate: event.endDate,
      timezone: event.timezone,
      isPublic: event.isPublic,
      coverUrl: event.images[0]?.url ?? null,
      author: event.author,
    },
    viewer: {
      hasAccess: await viewerHasAccess(link, viewerId),
    },
  }
}

export async function acceptInviteLink(token: string, userId: string) {
  const link = await resolveLink(token, userId)

  // Público e autor não precisam de convite; o aceite só navega.
  if (link.event.isPublic || userId === link.event.authorId) {
    return { eventId: link.event.id, created: false }
  }

  const created = await acceptLink(
    link.id,
    link.event.id,
    link.createdById,
    userId,
  )
  return { eventId: link.event.id, created }
}
