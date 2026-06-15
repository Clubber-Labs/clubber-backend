import * as Sentry from '@sentry/node'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod'
import { env } from './env'
import { handlePrismaUniqueError } from './errors'
import { FILE_TOO_LARGE_MESSAGE } from './uploads'

/**
 * Error handler global — ÚNICO ponto de tradução de erros para resposta HTTP.
 * Compartilhado entre o server de produção e o app de teste para que os testes
 * exercitem exatamente o mesmo tratamento (sem drift entre os dois).
 */
export function errorHandler(
  error: Error,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  // Constraint unique do Prisma → 409 com mensagem amigável (não vaza path/SQL).
  const uniqueErr = handlePrismaUniqueError(error)
  if (uniqueErr) {
    return reply
      .status(uniqueErr.statusCode)
      .send({ message: uniqueErr.message })
  }

  // @fastify/multipart: arquivo acima do teto sobe com texto cru em inglês
  // ('request file too large'). Padroniza para PT (imagem/áudio têm cap de 5 MB).
  if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
    return reply.status(413).send({ message: FILE_TOO_LARGE_MESSAGE })
  }

  if (hasZodFastifySchemaValidationErrors(error)) {
    const issues = error.validation.map((v) => ({
      path: v.instancePath || '/',
      message: v.message,
    }))
    request.log.warn(
      { issues, url: request.url, method: request.method },
      'Validação de request falhou',
    )
    return reply.status(400).send({ message: 'Dados inválidos.', issues })
  }

  // Erros explícitos do service (throw { statusCode, message }) e validações
  // do Fastify (4xx) passam adiante com a própria mensagem. `code` opcional
  // (machine-readable) é repassado para o cliente distinguir 4xx de mesmo status
  // sem casar a string da mensagem.
  const explicit = error as {
    statusCode?: number
    message?: string
    code?: string
  }
  if (explicit.statusCode && explicit.statusCode < 500) {
    return reply.status(explicit.statusCode).send({
      message: explicit.message ?? 'Erro',
      ...(explicit.code && { code: explicit.code }),
    })
  }

  // 500: log completo no servidor, body genérico em produção pra não vazar
  // stack/paths. Em dev/test mantém a mensagem original pra debugging.
  request.log.error({ err: error }, 'Unhandled error')
  // Rastreio no Sentry — no-op quando SENTRY_DSN não está configurado (inclusive
  // em testes). Só erros 500 genuínos; 4xx/409/413/400 não são reportados.
  Sentry.captureException(error, {
    tags: {
      route: request.routeOptions?.url ?? request.url,
      method: request.method,
    },
    extra: { reqId: request.id },
  })
  return reply.status(500).send({
    message:
      env.NODE_ENV === 'production'
        ? 'Erro interno do servidor.'
        : (error.message ?? 'Internal Server Error'),
  })
}
