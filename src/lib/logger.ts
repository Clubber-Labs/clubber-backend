import { pino } from 'pino'
import { env } from './env'

// Em teste fica em silêncio pra não poluir a saída do Vitest; nos demais
// ambientes loga no nível configurável via env.
const level =
  process.env.LOG_LEVEL ?? (env.NODE_ENV === 'test' ? 'silent' : 'info')

// Em desenvolvimento, formata bonito e colorido no terminal via pino-pretty.
// Em produção mantém JSON puro de uma linha (ideal pra agregadores de log) e
// em teste fica sem transport (silencioso). pino-pretty é devDependency: só é
// carregado quando NODE_ENV === 'development', então a build de prod não precisa dele.
const transport =
  env.NODE_ENV === 'development'
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss',
          // module vira prefixo da mensagem, então não repete no objeto abaixo.
          ignore: 'pid,hostname,reqId,module',
          // Prefixa a mensagem com o módulo (ex.: "chat-ws") quando houver.
          messageFormat: '{if module}[{module}] {end}{msg}',
          singleLine: false,
        },
      }
    : undefined

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
  ...(transport && { transport }),
})
