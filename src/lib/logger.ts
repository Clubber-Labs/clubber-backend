import { pino } from 'pino'
import { env } from './env'

const isDev = env.NODE_ENV === 'development'

export const logger = pino({
    level: env.LOG_LEVEL,
    ...(isDev && {
        transport: {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'HH:MM:ss',
                ignore: 'pid,hostname',
            },
        },
    }),
})