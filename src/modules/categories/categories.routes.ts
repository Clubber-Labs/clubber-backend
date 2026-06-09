import type { FastifyInstance } from 'fastify'
import { getCategories } from './categories.controller'

export async function categoriesRoutes(app: FastifyInstance) {
  // Público: o seletor de categorias aparece já no cadastro de perfil,
  // antes de o usuário ter token.
  app.get('/categories', getCategories)
}
