import { pino } from 'pino'
import { env } from './env'

const level =
  process.env.LOG_LEVEL ?? (env.NODE_ENV === 'test' ? 'silent' : 'info')

const SENSITIVE_QUERY = /([?&](?:token|ticket|access_token)=)[^&]*/gi

export function sanitizeLogUrl(url: string): string {
  return url.replace(SENSITIVE_QUERY, '$1[REDACTED]')
}

const transport =
  env.NODE_ENV === 'development'
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss',
          ignore: 'pid,hostname,reqId,module',
          messageFormat: '{if module}[{module}] {end}{msg}',
          singleLine: false,
        },
      }
    : undefined

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
  },
  ...(transport && { transport }),
})
