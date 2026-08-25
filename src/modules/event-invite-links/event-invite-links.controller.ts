import type { FastifyReply, FastifyRequest } from 'fastify'
import type {
  InviteLinkEventParam,
  InviteLinkIdParam,
  InviteTokenParam,
} from './event-invite-links.schema'
import {
  acceptInviteLink,
  createInviteLink,
  getInviteLinkPreview,
  listInviteLinks,
  revokeInviteLink,
} from './event-invite-links.service'

export async function postInviteLink(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { eventId } = request.params as InviteLinkEventParam
  const { link, created } = await createInviteLink(eventId, request.user.sub)
  request.log.info(
    { userId: request.user.sub, eventId, linkId: link.id, created },
    'User requested event invite link',
  )
  return reply.status(created ? 201 : 200).send(link)
}

export async function getInviteLinks(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { eventId } = request.params as InviteLinkEventParam
  const links = await listInviteLinks(eventId, request.user.sub)
  return reply.send(links)
}

export async function deleteInviteLink(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { eventId, linkId } = request.params as InviteLinkIdParam
  await revokeInviteLink(eventId, linkId, request.user.sub)
  request.log.info(
    { userId: request.user.sub, eventId, linkId },
    'User revoked event invite link',
  )
  return reply.status(204).send()
}

export async function getInvitePreview(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { token } = request.params as InviteTokenParam
  const preview = await getInviteLinkPreview(token, request.user?.sub)
  // Conteúdo de evento privado atrás de um token revogável: nenhum cache
  // intermediário pode servir isso depois da revogação.
  return reply.header('cache-control', 'no-store').send(preview)
}

export async function postAcceptInvite(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { token } = request.params as InviteTokenParam
  const { eventId, created } = await acceptInviteLink(token, request.user.sub)
  request.log.info(
    { userId: request.user.sub, eventId, created },
    'User accepted event invite link',
  )
  return reply.status(created ? 201 : 200).send({ eventId })
}
