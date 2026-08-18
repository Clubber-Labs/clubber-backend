import * as Sentry from '@sentry/node'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod'
import { env } from './env'
import { handlePrismaUniqueError } from './errors'
import { AppError } from './errors/app-error'

/**
 * Error handler global — ÚNICO ponto de tradução de erros para resposta HTTP.
 * Compartilhado entre o server de produção e o app de teste para que os testes
 * exercitem exatamente o mesmo tratamento (sem drift entre os dois).
 *
 * Contrato de erro: `code` (+ `params`/`field`) é o que o cliente traduz e
 * renderiza no idioma do usuário. `message` (inglês/código) existe para log,
 * Sentry e fallback de último recurso — nunca é copy de UI.
 */
export function errorHandler(
  error: Error,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  // Erros de negócio dos services (AppError): tradução 1:1 para o contrato.
  if (error instanceof AppError) {
    if (error.statusCode >= 500) {
      // 5xx de dependência (Places, gateway...): mesma observabilidade dos 500.
      request.log.error({ err: error, params: error.params }, error.code)
      Sentry.captureException(error, {
        tags: {
          route: request.routeOptions?.url ?? request.url,
          method: request.method,
        },
        extra: { reqId: request.id, params: error.params },
      })
    }
    return reply.status(error.statusCode).send({
      code: error.code,
      message: error.message,
      ...(error.field && { field: error.field }),
      ...(error.params && { params: error.params }),
    })
  }

  // Constraint unique do Prisma → 409 com código (não vaza path/SQL).
  const uniqueErr = handlePrismaUniqueError(error)
  if (uniqueErr) {
    return reply.status(uniqueErr.statusCode).send({
      code: uniqueErr.code,
      message: uniqueErr.code,
      ...(uniqueErr.field && { field: uniqueErr.field }),
    })
  }

  // @fastify/multipart: arquivo acima do teto (imagem/áudio têm cap de 5 MB).
  if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
    return reply.status(413).send({
      code: 'FILE_TOO_LARGE',
      message: 'FILE_TOO_LARGE',
      params: { maxMb: 5 },
    })
  }

  if (hasZodFastifySchemaValidationErrors(error)) {
    // `keyword`/`params` carregam o código nativo do Zod (too_small,
    // invalid_type...) e seus detalhes — já machine-readable, o app traduz.
    const issues = error.validation.map((v) => ({
      path: v.instancePath || '/',
      code: v.keyword,
      message: v.message,
      params: v.params,
    }))
    request.log.warn(
      { issues, url: request.url, method: request.method },
      'Validação de request falhou',
    )
    return reply
      .status(400)
      .send({ code: 'VALIDATION_ERROR', message: 'VALIDATION_ERROR', issues })
  }

  // 4xx de plugins do Fastify (jwt, rate-limit...): repassa o código FST_* e a
  // mensagem original — não são erros de negócio nossos.
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
    code: 'INTERNAL_ERROR',
    message:
      env.NODE_ENV === 'production'
        ? 'Internal Server Error'
        : (error.message ?? 'Internal Server Error'),
  })
}
