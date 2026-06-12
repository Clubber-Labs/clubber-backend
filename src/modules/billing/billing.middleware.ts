import type { FastifyReply, FastifyRequest } from 'fastify'
import { findUserIsPremium } from './billing.repository'

/**
 * Middleware Fastify (onRequest hook) que valida que o usuário autenticado
 * tem premium. Mora no módulo billing — dono do conceito — e lê o estado pelo
 * repository (`findUserIsPremium`), em vez de consultar a coluna direto. Usa
 * após `app.authenticate` no mesmo array de `onRequest`:
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
    throw { statusCode: 401, message: 'Autenticação necessária' }
  }

  if (!(await findUserIsPremium(userId))) {
    throw {
      statusCode: 403,
      message: 'Funcionalidade exclusiva para usuários Premium',
    }
  }
}
