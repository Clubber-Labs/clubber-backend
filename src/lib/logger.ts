import { pino } from 'pino'
import { env } from './env'

// Em teste fica em silêncio pra não poluir a saída do Vitest; nos demais
// ambientes loga em JSON estruturado (pino) no nível configurável via env.
const level =
  process.env.LOG_LEVEL ?? (env.NODE_ENV === 'test' ? 'silent' : 'info')

/**
 * Logger estruturado único do processo. É a instância usada pelo Fastify
 * (request.log/app.log herdam dela) e também por libs sem acesso ao app
 * (realtime, cache), garantindo um formato de log consistente.
 *
 * Redige cabeçalhos sensíveis pra não vazar token/credenciais nos logs.
 */
export const logger = pino({
  level,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'headers.authorization',
      'headers.cookie',
    ],
    remove: true,
  },
})
