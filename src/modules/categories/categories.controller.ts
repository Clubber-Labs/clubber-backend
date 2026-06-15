import type { FastifyReply, FastifyRequest } from 'fastify'
import { resolveLocale } from '../../lib/event-categories'
import { listGenres } from '../../lib/genres'
import { listCategoriesWithSubcategories } from '../../lib/subcategories'

export async function getCategories(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const locale = resolveLocale(request.headers['accept-language'])
  return reply.send({
    locale,
    data: listCategoriesWithSubcategories(locale),
    genres: listGenres(locale),
  })
}
