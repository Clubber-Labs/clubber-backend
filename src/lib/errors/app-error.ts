import type { ErrorCode } from './error-codes'

/**
 * Erro de negócio lançado pelos services e traduzido para HTTP pelo error
 * handler global. O cliente renderiza a partir de `code` + `params` no idioma
 * do usuário; `message` (= code, em inglês) existe só para log e Sentry.
 */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    /** Campo do formulário, quando o erro aponta um (ex.: 409 de cadastro). */
    readonly field?: string,
    /** Interpolação para o cliente: { maxMb: 50 }, { limit: 5 }... */
    readonly params?: Record<string, string | number>,
  ) {
    super(code)
    this.name = 'AppError'
  }
}
