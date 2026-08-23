import type { FastifyReply, FastifyRequest } from 'fastify'
import { listGenres } from '../../lib/genres'
import { listCategoriesWithSubcategories } from '../../lib/subcategories'

export async function getCategories(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { locale } = request
  return reply.send({
    locale,
    data: listCategoriesWithSubcategories(locale),
    genres: listGenres(locale),
  })
}
