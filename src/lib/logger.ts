import { type LoggerOptions, pino } from 'pino'
import { env } from './env'

const SENSITIVE_QUERY = /([?&](?:token|ticket|access_token)=)[^&]*/gi

export function sanitizeLogUrl(url: string): string {
  return url.replace(SENSITIVE_QUERY, '$1[REDACTED]')
}

const prettyTransport = {
  target: 'pino-pretty',
  options: {
    colorize: true,
    translateTime: 'SYS:HH:MM:ss',
    ignore: 'pid,hostname,reqId,module',
    messageFormat: '{if module}[{module}] {end}{msg}',
    singleLine: false,
  },
}

// Define para onde os logs vão:
// - test  → sem transport (nível silent já suprime tudo, sem worker thread)
// - dev   → pino-pretty no terminal
// - prod  → JSON no stdout (a plataforma coleta)
// Com LOKI_URL setado, adiciona o envio ao Loki via pino-loki (multi-target).
// A instrumentação pino do OpenTelemetry injeta trace_id/span_id nos logs, então
// o Grafana correlaciona log↔trace pelo trace_id.
function buildTransport(): LoggerOptions['transport'] {
  if (env.NODE_ENV === 'test') return undefined

  const isDev = env.NODE_ENV === 'development'
  const stdout = isDev
    ? prettyTransport
    : { target: 'pino/file', options: { destination: 1 } }

  if (!env.LOKI_URL) {
    return isDev ? prettyTransport : undefined
  }

  return {
    targets: [
      stdout,
      {
        target: 'pino-loki',
        options: {
          host: env.LOKI_URL,
          labels: { service: env.OTEL_SERVICE_NAME },
          batching: true,
          interval: 5,
          // Não derruba/trava a aplicação se o Loki estiver indisponível.
          silenceErrors: true,
        },
      },
    ],
  }
}

/**
 * Opções base do logger pino, compartilhadas entre o logger standalone (abaixo)
 * e o logger do Fastify (server.ts) para evitar drift de redaction/serializers.
 */
export function buildLoggerOptions(): LoggerOptions {
  return {
    level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'headers.authorization',
        'headers.cookie',
      ],
      remove: true,
    },
    serializers: {
      err: (err: Error) => ({
        type: err.constructor.name,
        message: err.message,
        stack: err.stack ?? '',
        ...((err as { code?: string }).code && {
          code: (err as { code?: string }).code,
        }),
      }),
      req(request: {
        method: string
        url: string
        host?: string
        hostname?: string
        ip?: string
      }) {
        return {
          method: request.method,
          url: sanitizeLogUrl(request.url),
          host: request.host ?? request.hostname,
          remoteAddress: request.ip,
        }
      },
      res: (res: { statusCode: number }) => ({
        statusCode: res.statusCode,
      }),
    },
    transport: buildTransport(),
  }
}

/**
 * Logger standalone para contextos FORA de uma request (ex.: reconcilers, jobs).
 * NÃO carrega `reqId` automaticamente — esse é adicionado pelo logger filho do
 * Fastify (`request.log`). No caminho de uma request, prefira `request.log`.
 * O trace_id é injetado pelo OpenTelemetry em ambos quando o tracing está ativo.
 */
export const logger = pino(buildLoggerOptions())
