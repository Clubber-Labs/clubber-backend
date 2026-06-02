import type { FastifyReply, FastifyRequest } from 'fastify'
import { listCategories, resolveLocale } from '../../lib/event-categories'

export async function getCategories(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const locale = resolveLocale(request.headers['accept-language'])
  return reply.send({ locale, data: listCategories(locale) })
}
