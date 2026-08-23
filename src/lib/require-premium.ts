import type { FastifyReply, FastifyRequest } from 'fastify'
import { AppError } from './errors/app-error'
import { prisma } from './prisma'

/**
 * Middleware Fastify (onRequest hook) que valida que o usuário autenticado
 * tem `isPremium = true`. Usa após `app.authenticate` no mesmo array de
 * `onRequest`:
 *
 *   { onRequest: [app.authenticate, requirePremium] }
 *
 * Lança 403 se não-premium; 401 se request.user.sub não existir (auth
 * deveria ter rodado antes).
 */
export async function requirePremium(
  request: FastifyRequest,
  _reply: FastifyReply,
) {
  const userId = request.user?.sub
  if (!userId) {
    throw new AppError(401, 'AUTH_REQUIRED')
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isPremium: true },
  })

  if (!user?.isPremium) {
    throw new AppError(403, 'PREMIUM_REQUIRED')
  }
}
