import path from 'node:path'
import { z } from 'zod'

const baseSchema = z.object({
  DATABASE_URL: z.url(),
  JWT_SECRET: z.string().min(1, 'JWT_SECRET não configurado'),
  PORT: z.coerce.number().int().positive().default(3333),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PUBLIC_URL: z.url().default('http://localhost:3333'),
  REDIS_URL: z
    .string()
    .regex(/^rediss?:\/\//, 'REDIS_URL deve começar com redis:// ou rediss://')
    .optional(),
  STORAGE_DRIVER: z.enum(['cloudinary', 'local']).optional(),
  UPLOADS_DIR: z.string().optional(),
  // Envio de e-mail (recuperação de senha). Driver `log` (default) só loga o
  // conteúdo — seguro em dev/test sem credencial. `resend` envia de verdade.
  EMAIL_DRIVER: z.enum(['log', 'resend']).default('log'),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('ConnectAI <no-reply@connectai.app>'),
  // Recuperação de senha: validade do código OTP e teto de tentativas por código
  // (anti brute-force no espaço de 6 dígitos).
  PASSWORD_RESET_CODE_TTL_MINUTES: z.coerce
    .number()
    .int()
    .positive()
    .default(15),
  PASSWORD_RESET_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  // Cooldown (s) entre solicitações de código por conta: enquanto houver um código
  // ativo criado há menos disto, não geramos/enviamos outro — barra email bombing
  // e limita o brute-force via regeneração de código (cap de tentativas por código
  // deixaria de ter efeito se desse pra trocar de código à vontade).
  PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(60),
  // Expurgo (minimização/retenção LGPD) dos códigos já usados/expirados.
  PASSWORD_RESET_CLEANUP_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(3600000),
  PASSWORD_RESET_CLEANUP_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_PLACES_API_KEY: z.string().optional(),
  FACEBOOK_APP_ID: z.string().optional(),
  FACEBOOK_APP_SECRET: z.string().optional(),
  FEATURED_RECONCILE_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(300000),
  // z.coerce.boolean() usa Boolean() do JS — "false"/"0" virariam true.
  // Aceita explicitamente as strings comuns e transforma manualmente.
  FEATURED_RECONCILE_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
    .default('info'),
  // Observabilidade — todas OFF por padrão quando não configuradas.
  // NOTA: SENTRY_DSN e OTEL_* também são lidas CRUAS em src/instrumentation.ts
  // (que não pode importar este arquivo por ordem de carga). Manter em sincronia.
  SENTRY_DSN: z.url().optional(),
  OTEL_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
  OTEL_SERVICE_NAME: z.string().default('connectai-backend'),
  // URL do Loki para envio dos logs (via pino-loki). Sem ela, logs só no stdout.
  LOKI_URL: z.url().optional(),
  // Métricas Prometheus em /metrics. Default ligado (o scraper precisa delas).
  METRICS_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  // Se definido, /metrics exige `Authorization: Bearer <token>`. Sem ele, o
  // endpoint é aberto (modelo pull) — proteja na borda de rede ou defina o token.
  METRICS_TOKEN: z.string().min(1).optional(),
  // Cota de armazenamento de mídia por usuário (anti-abuso/custo). Default 1 GB.
  CHAT_USER_STORAGE_QUOTA_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(1024 * 1024 * 1024),
  // Exclusão de conta (soft-delete): carência antes da anonimização, intervalo
  // do reconciler que processa as exclusões agendadas, e flag liga/desliga.
  ACCOUNT_DELETION_GRACE_DAYS: z.coerce.number().int().positive().default(30),
  ACCOUNT_DELETION_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(3600000),
  ACCOUNT_DELETION_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  // Notificações (push + in-app). Master switch da feature — OFF por padrão
  // (opt-in). Quando ligada, a fila de fan-out e os gatilhos passam a publicar.
  NOTIFICATIONS_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  // Token de acesso do projeto Expo (opcional). Necessário só se "Enhanced
  // Security for Push Notifications" estiver ligado no painel Expo/EAS.
  EXPO_ACCESS_TOKEN: z.string().optional(),
  // Retenção (minimização LGPD) das notificações in-app: expurgo do que passou
  // do prazo, no padrão dos demais reconcilers.
  NOTIFY_RETENTION_DAYS: z.coerce.number().int().positive().default(180),
  NOTIFY_RETENTION_CLEANUP_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(3600000),
  NOTIFY_RETENTION_CLEANUP_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  // Proximidade. NOTIFY_MAX_RADIUS_KM é o teto do raio por usuário E a constante
  // do pré-filtro indexável (ST_DWithin) da query invertida. NOTIFY_LOCATION_TTL_DAYS
  // = janela de frescor; localização mais velha não recebe push de proximidade e
  // é expurgada pelo reconciler (minimização LGPD).
  NOTIFY_MAX_RADIUS_KM: z.coerce.number().int().positive().default(50),
  NOTIFY_LOCATION_TTL_DAYS: z.coerce.number().int().positive().default(90),
  NOTIFY_LOCATION_CLEANUP_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(3600000),
  NOTIFY_LOCATION_CLEANUP_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  // Fan-out de proximidade + receipts. BATCH_SIZE = tamanho da página da query
  // invertida. RECEIPTS_DELAY_MS = idade mínima de um ticket antes de checar o
  // receipt (o Expo recomenda ~15min). RECEIPTS_INTERVAL_MS = tick do reconciler.
  NOTIFY_FANOUT_BATCH_SIZE: z.coerce.number().int().positive().default(500),
  NOTIFY_RECEIPTS_DELAY_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60 * 1000),
  NOTIFY_RECEIPTS_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 60 * 1000),
  NOTIFY_RECEIPTS_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
})

const cloudinarySchema = z.object({
  CLOUDINARY_CLOUD_NAME_DEV: z.string().optional(),
  CLOUDINARY_API_KEY_DEV: z.string().optional(),
  CLOUDINARY_API_SECRET_DEV: z.string().optional(),
  CLOUDINARY_CLOUD_NAME_PROD: z.string().optional(),
  CLOUDINARY_API_KEY_PROD: z.string().optional(),
  CLOUDINARY_API_SECRET_PROD: z.string().optional(),
  // Opcional (recurso pago do Cloudinary): URL auth key para URLs assinadas com
  // EXPIRAÇÃO (auth_token). Sem ela, as URLs são assinadas mas não expiram.
  CLOUDINARY_AUTH_TOKEN_KEY: z.string().optional(),
})

const parsed = baseSchema
  .extend(cloudinarySchema.shape)
  // Falha de boot (em vez de falha silenciosa): o driver `log` nunca pode rodar em
  // produção — ele não envia e-mail e ainda escreveria o código OTP no log. Mesma
  // postura do resolveCloudinaryCredentials, que também dá hard-fail em produção.
  .refine((v) => !(v.NODE_ENV === 'production' && v.EMAIL_DRIVER === 'log'), {
    path: ['EMAIL_DRIVER'],
    message:
      "EMAIL_DRIVER='log' não é permitido em produção. Configure EMAIL_DRIVER=resend e RESEND_API_KEY.",
  })
  // Boot falha em vez de silenciar todos os envios: sem a chave, o ResendMailer
  // lança 502 a cada envio, que o requestPasswordReset engole (best-effort) e
  // ninguém percebe que nenhum e-mail saiu.
  .refine((v) => !(v.EMAIL_DRIVER === 'resend' && !v.RESEND_API_KEY), {
    path: ['RESEND_API_KEY'],
    message: "RESEND_API_KEY é obrigatório quando EMAIL_DRIVER='resend'.",
  })
  // Boot falha em vez de silenciar o fan-out: a fila de notificações roda sobre
  // o Redis. Sem REDIS_URL em produção com a feature ligada, todo enqueue seria
  // no-op e ninguém notificaria — sem erro visível.
  .refine(
    (v) =>
      !(v.NODE_ENV === 'production' && v.NOTIFICATIONS_ENABLED && !v.REDIS_URL),
    {
      path: ['REDIS_URL'],
      message:
        'REDIS_URL é obrigatório quando NOTIFICATIONS_ENABLED=true em produção (a fila de notificações precisa do Redis).',
    },
  )
  .parse(process.env)

const STORAGE_DRIVER: 'cloudinary' | 'local' =
  parsed.STORAGE_DRIVER ?? 'cloudinary'

export type CloudinaryCredentials = {
  cloudName: string
  apiKey: string
  apiSecret: string
}

export function resolveCloudinaryCredentials(): CloudinaryCredentials {
  const isProd = parsed.NODE_ENV === 'production'
  const cloudName = isProd
    ? parsed.CLOUDINARY_CLOUD_NAME_PROD
    : parsed.CLOUDINARY_CLOUD_NAME_DEV
  const apiKey = isProd
    ? parsed.CLOUDINARY_API_KEY_PROD
    : parsed.CLOUDINARY_API_KEY_DEV
  const apiSecret = isProd
    ? parsed.CLOUDINARY_API_SECRET_PROD
    : parsed.CLOUDINARY_API_SECRET_DEV

  if (!cloudName || !apiKey || !apiSecret) {
    const suffix = isProd ? 'PROD' : 'DEV'
    throw new Error(
      `Cloudinary não configurado para ${parsed.NODE_ENV}. Defina CLOUDINARY_CLOUD_NAME_${suffix}, CLOUDINARY_API_KEY_${suffix} e CLOUDINARY_API_SECRET_${suffix}.`,
    )
  }

  return { cloudName, apiKey, apiSecret }
}

export const env = {
  DATABASE_URL: parsed.DATABASE_URL,
  JWT_SECRET: parsed.JWT_SECRET,
  PORT: parsed.PORT,
  NODE_ENV: parsed.NODE_ENV,
  PUBLIC_URL: parsed.PUBLIC_URL,
  REDIS_URL: parsed.REDIS_URL,
  STORAGE_DRIVER,
  UPLOADS_DIR: path.resolve(
    parsed.UPLOADS_DIR ?? path.join(process.cwd(), 'uploads'),
  ),
  EMAIL_DRIVER: parsed.EMAIL_DRIVER,
  RESEND_API_KEY: parsed.RESEND_API_KEY,
  EMAIL_FROM: parsed.EMAIL_FROM,
  PASSWORD_RESET_CODE_TTL_MINUTES: parsed.PASSWORD_RESET_CODE_TTL_MINUTES,
  PASSWORD_RESET_MAX_ATTEMPTS: parsed.PASSWORD_RESET_MAX_ATTEMPTS,
  PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS:
    parsed.PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS,
  PASSWORD_RESET_CLEANUP_INTERVAL_MS: parsed.PASSWORD_RESET_CLEANUP_INTERVAL_MS,
  PASSWORD_RESET_CLEANUP_ENABLED: parsed.PASSWORD_RESET_CLEANUP_ENABLED,
  GOOGLE_CLIENT_ID: parsed.GOOGLE_CLIENT_ID,
  GOOGLE_PLACES_API_KEY: parsed.GOOGLE_PLACES_API_KEY,
  FACEBOOK_APP_ID: parsed.FACEBOOK_APP_ID,
  FACEBOOK_APP_SECRET: parsed.FACEBOOK_APP_SECRET,
  FEATURED_RECONCILE_INTERVAL_MS: parsed.FEATURED_RECONCILE_INTERVAL_MS,
  FEATURED_RECONCILE_ENABLED: parsed.FEATURED_RECONCILE_ENABLED,
  LOG_LEVEL: parsed.LOG_LEVEL,
  SENTRY_DSN: parsed.SENTRY_DSN,
  OTEL_ENABLED: parsed.OTEL_ENABLED,
  OTEL_EXPORTER_OTLP_ENDPOINT: parsed.OTEL_EXPORTER_OTLP_ENDPOINT,
  OTEL_SERVICE_NAME: parsed.OTEL_SERVICE_NAME,
  LOKI_URL: parsed.LOKI_URL,
  METRICS_ENABLED: parsed.METRICS_ENABLED,
  METRICS_TOKEN: parsed.METRICS_TOKEN,
  CLOUDINARY_AUTH_TOKEN_KEY: parsed.CLOUDINARY_AUTH_TOKEN_KEY,
  CHAT_USER_STORAGE_QUOTA_BYTES: parsed.CHAT_USER_STORAGE_QUOTA_BYTES,
  ACCOUNT_DELETION_GRACE_DAYS: parsed.ACCOUNT_DELETION_GRACE_DAYS,
  ACCOUNT_DELETION_INTERVAL_MS: parsed.ACCOUNT_DELETION_INTERVAL_MS,
  ACCOUNT_DELETION_ENABLED: parsed.ACCOUNT_DELETION_ENABLED,
  NOTIFICATIONS_ENABLED: parsed.NOTIFICATIONS_ENABLED,
  EXPO_ACCESS_TOKEN: parsed.EXPO_ACCESS_TOKEN,
  NOTIFY_RETENTION_DAYS: parsed.NOTIFY_RETENTION_DAYS,
  NOTIFY_RETENTION_CLEANUP_INTERVAL_MS:
    parsed.NOTIFY_RETENTION_CLEANUP_INTERVAL_MS,
  NOTIFY_RETENTION_CLEANUP_ENABLED: parsed.NOTIFY_RETENTION_CLEANUP_ENABLED,
  NOTIFY_MAX_RADIUS_KM: parsed.NOTIFY_MAX_RADIUS_KM,
  NOTIFY_LOCATION_TTL_DAYS: parsed.NOTIFY_LOCATION_TTL_DAYS,
  NOTIFY_LOCATION_CLEANUP_INTERVAL_MS:
    parsed.NOTIFY_LOCATION_CLEANUP_INTERVAL_MS,
  NOTIFY_LOCATION_CLEANUP_ENABLED: parsed.NOTIFY_LOCATION_CLEANUP_ENABLED,
  NOTIFY_FANOUT_BATCH_SIZE: parsed.NOTIFY_FANOUT_BATCH_SIZE,
  NOTIFY_RECEIPTS_DELAY_MS: parsed.NOTIFY_RECEIPTS_DELAY_MS,
  NOTIFY_RECEIPTS_INTERVAL_MS: parsed.NOTIFY_RECEIPTS_INTERVAL_MS,
  NOTIFY_RECEIPTS_ENABLED: parsed.NOTIFY_RECEIPTS_ENABLED,
} as const
