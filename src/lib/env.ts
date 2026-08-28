import path from 'node:path'
import { z } from 'zod'
import { discoverChatKeks } from './crypto/chat-keks'

const PRIVATE_IPV4 =
  /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/

/**
 * Host do Redis que não sai da máquina/rede interna: nome de serviço de um
 * único rótulo (DNS interno do Docker/Coolify, ex. `redis-service`), loopback
 * ou IP privado. Qualquer outra coisa é tratada como externa — inclusive URL
 * que não parseia, para o caso duvidoso exigir TLS em vez de liberar.
 */
export function isInternalRedisHost(url: string): boolean {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    return false
  }
  const bare = host.startsWith('[') ? host.slice(1, -1) : host
  // `new URL('redis://')` não lança: devolve host vazio. Sem esta guarda ele
  // cairia na regra do rótulo único e passaria por interno.
  if (!bare) return false
  if (bare === 'localhost' || bare === '::1') return true
  if (PRIVATE_IPV4.test(bare)) return true
  // Sem ponto = rótulo único, que só resolve dentro da rede do compose.
  return !bare.includes('.')
}

// Lido uma vez, na carga: as KEKs não mudam em runtime, e os refines abaixo
// precisam do resultado para decidir se o boot segue.
const chatKeks = discoverChatKeks()

const baseSchema = z.object({
  DATABASE_URL: z.url(),
  JWT_SECRET: z.string().min(1, 'JWT_SECRET não configurado'),
  // Validade do token de SESSÃO. Antes os tokens eram emitidos sem `exp` e
  // valiam para sempre — um token vazado dava acesso permanente, sem rotação.
  // Aceita o formato do `ms`/jsonwebtoken (ex.: '15m', '7d'). Curto de propósito:
  // o access expira rápido e o refresh token (abaixo) renova a sessão de forma
  // transparente. Em ambiente já implantado, manter um valor alto via env até o
  // app com refresh estar publicado, e só então baixar pra 15m.
  JWT_EXPIRES_IN: z
    .string()
    .regex(
      /^\d+[smhd]$|^\d+$/,
      "JWT_EXPIRES_IN inválido (ex.: '15m', '1h', '7d' ou segundos)",
    )
    .default('15m'),
  // Vida do refresh token (sessão longa, rotativo e revogável no banco). O usuário
  // fica logado até esse prazo de inatividade; cada uso rotaciona e renova a janela.
  REFRESH_TOKEN_EXPIRES_IN: z
    .string()
    .regex(
      /^\d+[smhd]$|^\d+$/,
      "REFRESH_TOKEN_EXPIRES_IN inválido (ex.: '30d', '90d' ou segundos)",
    )
    .default('90d'),
  // Janela de carência (ms) para reuso de um refresh token recém-rotacionado. O
  // app mobile reapresenta o MESMO token o tempo todo de forma benigna: refresh
  // concorrente (várias requisições renovando juntas após o access expirar) ou
  // retry de uma resposta perdida na rede. Dentro desta janela isso é tratado
  // como benigno (reemite a sessão) em vez de assumir comprometimento e derrubar
  // TODAS as sessões. Curta de propósito: FORA dela, reusar um token rotacionado
  // continua sendo sinal de roubo e dispara a revogação da família. 0 desliga a
  // carência (volta ao comportamento estrito). Revogação intencional (logout/
  // reset/MFA) não cria janela — o token morre na hora.
  REFRESH_TOKEN_REUSE_GRACE_MS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(30_000),
  // CSV de origens permitidas no CORS (ex.: 'https://app.clubber.social,https://admin...').
  // Em produção é OBRIGATÓRIO definir (sem ele o boot falha) — não refletimos
  // qualquer Origin com credentials em prod. Em dev/test, vazio = reflete a
  // Origin da requisição (comportamento permissivo, conveniente localmente).
  CORS_ALLOWED_ORIGINS: z.string().optional(),
  // CSV de IPs/CIDRs dos proxies confiáveis na frente da API (ex.: o LB/Nginx/
  // Cloudflare em produção). Alimenta o `trustProxy` do Fastify: só então o
  // `request.ip` (usado pelo rate-limit) vem do X-Forwarded-For — e SÓ quando a
  // conexão chega de um proxy listado, nunca de um X-Forwarded-For forjado pelo
  // cliente. Vazio (dev/sem proxy) = trustProxy false = usa o IP do socket.
  // Mesma env consumida pelo consent.controller para resolver o IP do auditado.
  TRUSTED_PROXIES: z.string().default(''),
  PORT: z.coerce.number().int().positive().default(3333),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PUBLIC_URL: z.url().default('http://localhost:3333'),
  // Host público dos links compartilháveis (https://clubber.social). Separado do
  // PUBLIC_URL porque a API pode viver em outro domínio (api.*).
  SHARE_BASE_URL: z.url().optional(),
  REDIS_URL: z
    .string()
    .regex(/^rediss?:\/\//, 'REDIS_URL deve começar com redis:// ou rediss://')
    .optional(),
  // Rate limiting (@fastify/rate-limit). Master switch + ajuste global. Os
  // defaults preservam o comportamento atual (ligado, fator 1, janela de 1 min).
  // Para testes de carga: RATE_LIMIT_ENABLED=false desliga todo o throttling, ou
  // RATE_LIMIT_MAX_FACTOR alto relaxa os limites medindo throughput puro.
  RATE_LIMIT_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  // .finite() barra Infinity (positivo e numérico, passaria) — manteria max: Infinity.
  RATE_LIMIT_MAX_FACTOR: z.coerce.number().positive().finite().default(1),
  // Regex valida o formato do timeWindow no boot (em vez de só quebrar quando o
  // @fastify/rate-limit tenta parsear a string ao registrar as rotas).
  RATE_LIMIT_WINDOW: z
    .string()
    .regex(
      /^\d+\s*(ms|milliseconds?|s|seconds?|m|minutes?|h|hours?|d|days?)$/,
      "RATE_LIMIT_WINDOW deve ser no formato '1 minute', '30 seconds', '1 hour'…",
    )
    .default('1 minute'),
  STORAGE_DRIVER: z.enum(['local', 'r2']).optional(),
  UPLOADS_DIR: z.string().optional(),
  // Envio de e-mail (recuperação de senha). Driver `log` (default) só loga o
  // conteúdo — seguro em dev/test sem credencial. `resend` envia de verdade.
  EMAIL_DRIVER: z.enum(['log', 'resend']).default('log'),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('Clubber <no-reply@clubber.social>'),
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
  ANTHROPIC_API_KEY: z.string().optional(),
  // Spotify — conta VINCULADA (não é login). Diferente do Google/Apple, aqui há
  // troca de code por token, então o secret é server-side. Sem o par, as rotas
  // de /spotify respondem 500 e a feature fica desligada.
  SPOTIFY_CLIENT_ID: z.string().optional(),
  SPOTIFY_CLIENT_SECRET: z.string().optional(),
  // Precisa bater EXATAMENTE com o registrado no Spotify Dashboard. Nunca vem
  // do cliente: o backend usa este valor na troca do code.
  SPOTIFY_REDIRECT_URI: z.string().min(1).default('clubber://spotify-callback'),
  // Janela do /me/top/artists. 'medium_term' (~6 meses) equilibra atual e
  // estável; 'short_term' oscila demais pra virar identidade de perfil.
  SPOTIFY_TOP_TIME_RANGE: z
    .enum(['short_term', 'medium_term', 'long_term'])
    .default('medium_term'),
  // Audience do identityToken do "Sign in with Apple" (bundle id do app iOS).
  // Sem secret: a verificação usa o JWKS público da Apple.
  APPLE_BUNDLE_ID: z.string().default('com.netobonato.clubber'),
  // Universal Links / App Links (.well-known servidos em SHARE_BASE_URL).
  // Valores públicos por natureza (qualquer um lê o AASA de qualquer site);
  // os defaults são os do app oficial e as envs existem para staging/fork.
  APPLE_TEAM_ID: z.string().default('K238P4B9K4'),
  ANDROID_PACKAGE_NAME: z.string().default('com.netobonato.clubber'),
  // CSV: aceita mais de um fingerprint (ex.: chave do Play App Signing + chave
  // de build interno do EAS) — todos abrem o app.
  ANDROID_CERT_SHA256: z
    .string()
    .default(
      '22:36:8C:18:AC:6F:70:89:DC:FC:7D:46:0A:66:0C:24:56:19:50:F3:DF:C4:84:79:01:EB:A0:CB:07:62:38:6D',
    ),
  // Botões da landing de convite. A URL da App Store precisa do id numérico da
  // loja — sem ela o botão iOS não aparece.
  APP_STORE_URL: z.url().optional(),
  PLAY_STORE_URL: z
    .url()
    .default(
      'https://play.google.com/store/apps/details?id=com.netobonato.clubber',
    ),
  FEATURED_RECONCILE_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(300000),
  // Quota mensal de promoções de evento por usuário premium (RF11.4+).
  PROMOTION_MONTHLY_LIMIT: z.coerce.number().int().positive().default(3),
  // Duração máxima de UM destaque (em dias). A quota mensal conta destaques,
  // não tempo; sem este teto um único destaque poderia durar até a data do
  // evento, monopolizando o feed gastando só 1 dos N créditos do mês.
  PROMOTION_MAX_DURATION_DAYS: z.coerce.number().int().positive().default(7),
  // z.coerce.boolean() usa Boolean() do JS — "false"/"0" virariam true.
  // Aceita explicitamente as strings comuns e transforma manualmente.
  FEATURED_RECONCILE_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  // Reposição de ocorrências de séries recorrentes (RF11.6). Default 6h.
  RECURRENCE_RECONCILE_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(21_600_000),
  RECURRENCE_RECONCILE_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  STRIPE_SECRET_KEY: z
    .string()
    .regex(
      /^sk_(test|live)_/,
      'STRIPE_SECRET_KEY deve começar com sk_test_ ou sk_live_',
    ),
  STRIPE_WEBHOOK_SECRET: z
    .string()
    .regex(/^whsec_/, 'STRIPE_WEBHOOK_SECRET deve começar com whsec_'),
  STRIPE_PREMIUM_PRICE_ID: z
    .string()
    .regex(/^price_/, 'STRIPE_PREMIUM_PRICE_ID deve começar com price_'),
  STRIPE_CHECKOUT_SUCCESS_URL: z.url(),
  STRIPE_CHECKOUT_CANCEL_URL: z.url(),
  // CSV de hosts (incluir porta se necessário) permitidos para override
  // de success/cancel URL via body do POST /billing/checkout. Defesa contra
  // open-redirect: usuário hostil mandando `successUrl: https://evil.com/...`
  // recebia URL com session_id e potencialmente outras infos sensíveis.
  // Default cobre apenas localhost de dev.
  STRIPE_CHECKOUT_ALLOWED_REDIRECT_HOSTS: z
    .string()
    .default('localhost:3000,localhost:3333'),
  // Retenção (minimização LGPD) dos webhook_events do billing: o payload
  // guarda o evento Stripe inteiro (e-mail, nome, dados de cobrança). A
  // idempotência só precisa de janela recente (Stripe reenvia por ~3 dias);
  // além do prazo, expurgo no padrão dos demais reconcilers.
  BILLING_WEBHOOK_RETENTION_DAYS: z.coerce
    .number()
    .int()
    .positive()
    .default(90),
  BILLING_WEBHOOK_RETENTION_CLEANUP_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(3600000),
  BILLING_WEBHOOK_RETENTION_CLEANUP_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  // Rede de segurança pra webhook perdido: re-sincroniza do Stripe (fonte de
  // verdade) subscriptions "ativas" com currentPeriodEnd vencido além do
  // grace. Sem isso, um customer.subscription.deleted perdido deixa o usuário
  // premium pra sempre. Grace acomoda a janela de renovação/retry do gateway.
  BILLING_SYNC_INTERVAL_MS: z.coerce.number().int().positive().default(3600000),
  BILLING_SYNC_GRACE_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(6 * 3600000),
  // Janela da varredura de assinaturas órfãs (existem no Stripe, nunca
  // chegaram ao banco — `customer.subscription.created` perdido). Cobre com
  // folga o retry do próprio Stripe (~3 dias); varrer a conta inteira a cada
  // tick não escala.
  BILLING_ORPHAN_LOOKBACK_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(7 * 24 * 3600000),
  BILLING_SYNC_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  // Sync do gosto musical: tick de hora em hora, mas cada vínculo só "vence"
  // depois de MAX_AGE — assim a carga se espalha em vez de estourar de uma vez.
  SPOTIFY_SYNC_INTERVAL_MS: z.coerce.number().int().positive().default(3600000),
  SPOTIFY_SYNC_MAX_AGE_MS: z.coerce.number().int().positive().default(86400000),
  SPOTIFY_SYNC_ENABLED: z
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
  OTEL_SERVICE_NAME: z.string().default('clubber-backend'),
  // URL do Loki para envio dos logs (via pino-loki). Sem ela, logs só no stdout.
  LOKI_URL: z.url().optional(),
  // Métricas Prometheus em /metrics. Default ligado (o scraper precisa delas).
  METRICS_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  // Se definido, /metrics exige `Authorization: Bearer <token>`. Em produção com
  // METRICS_ENABLED ligado o token é OBRIGATÓRIO (o boot falha sem ele — refine
  // no fim do schema). Em dev/test, sem token, o endpoint fica aberto (conveniência).
  METRICS_TOKEN: z.string().min(1).optional(),
  // Cota de armazenamento de mídia por usuário (anti-abuso/custo). Default 1 GB.
  CHAT_USER_STORAGE_QUOTA_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(1024 * 1024 * 1024),
  // Chaves mestras (KEK) do envelope encryption do chat: 32 bytes em base64.
  // Única família de vars do projeto que NÃO aparece estaticamente aqui: cada
  // rotação acrescenta uma `CHAT_KEK_V<n>`, então quem as descobre é
  // `discoverChatKeks` (src/lib/crypto/chat-keks.ts) e quem as documenta é o
  // DEPLOY.md. Sem teto de versão — o teto anterior fazia a 2ª rotação exigir
  // mudança de código.
  //
  // A rotação mantém as DUAS no ambiente: a antiga continua desembrulhando o que
  // o reconciler de rewrap ainda não reembrulhou. Só sai depois que os pendentes
  // zeram (chat_kek_rewrap_pending em /metrics).
  CHAT_KEK_ACTIVE_VERSION: z.coerce.number().int().min(1).default(1),
  // Reconciler que reembrulha as DEKs na KEK ativa. Desligar CONGELA a rotação:
  // o que já está na versão antiga fica lá, e a KEK antiga não pode sair do
  // ambiente.
  CHAT_KEK_REWRAP_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(3600000),
  CHAT_KEK_REWRAP_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  // O preview do push carrega o texto DECIFRADO da mensagem para APNs/FCM, que
  // estão fora do nosso perímetro. Desligar faz o worker nem decifrar: o push
  // vira só "nova mensagem". É o botão para cortar esse vazamento sem deploy.
  CHAT_PUSH_PREVIEW_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  // Contexto capturado no snapshot da denúncia. Assédio e ameaça se avaliam pelo
  // que PRECEDE a mensagem — uma frase isolada pode ser resposta legítima a uma
  // agressão anterior. 10 cobre uma troca típica sem virar exportação da
  // conversa (minimização LGPD); o "depois" é pequeno e costuma vir vazio no
  // instante da denúncia, existindo para capturar a réplica imediata.
  CHAT_EVIDENCE_CONTEXT_BEFORE: z.coerce.number().int().min(0).default(10),
  CHAT_EVIDENCE_CONTEXT_AFTER: z.coerce.number().int().min(0).default(3),
  // Retenção da prova. Sem prazo, o snapshot vira arquivo eterno de conversa
  // privada — é o reconciler que fecha o ciclo do Art. 16 da LGPD.
  CHAT_EVIDENCE_RETENTION_DAYS: z.coerce.number().int().positive().default(180),
  CHAT_EVIDENCE_CLEANUP_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(3600000),
  CHAT_EVIDENCE_CLEANUP_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
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
  // Moderação: o reconciler que expira suspensões temporárias vencidas
  // (SUSPENDED com suspendedUntil <= now → ACTIVE). Banimento é permanente.
  SUSPENSION_RECONCILE_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(3600000),
  SUSPENSION_RECONCILE_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  // Lifecycle de spots: lembrete de renovação + limpeza no vencimento.
  SPOT_LIFECYCLE_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(3600000),
  SPOT_LIFECYCLE_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  // Antecedência do lembrete de renovação antes do endsAt (default 1h).
  SPOT_RENEWAL_LEAD_MS: z.coerce.number().int().positive().default(3600000),
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
  // Teto do raio (km) da recomendação de spots — espelha NOTIFY_MAX_RADIUS_KM.
  // min(2) = piso do schema de request (radiusKm/spotRadiusKm): abaixo disso a
  // feature ficaria inutilizável (todo raio válido cairia no 400 do teto).
  SPOT_MAX_RADIUS_KM: z.coerce.number().int().min(2).default(50),
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

const r2Schema = z.object({
  R2_ACCOUNT_ID_DEV: z.string().optional(),
  R2_ACCESS_KEY_ID_DEV: z.string().optional(),
  R2_SECRET_ACCESS_KEY_DEV: z.string().optional(),
  R2_BUCKET_PUBLIC_DEV: z.string().optional(),
  R2_BUCKET_PRIVATE_DEV: z.string().optional(),
  R2_PUBLIC_BASE_URL_DEV: z.string().optional(),
  R2_ACCOUNT_ID_PROD: z.string().optional(),
  R2_ACCESS_KEY_ID_PROD: z.string().optional(),
  R2_SECRET_ACCESS_KEY_PROD: z.string().optional(),
  R2_BUCKET_PUBLIC_PROD: z.string().optional(),
  R2_BUCKET_PRIVATE_PROD: z.string().optional(),
  R2_PUBLIC_BASE_URL_PROD: z.string().optional(),
})

const parsed = baseSchema
  .extend(cloudinarySchema.shape)
  .extend(r2Schema.shape)
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
  // O realtime publica a mensagem JÁ DECIFRADA no pub/sub: o texto em claro
  // atravessa o Redis. Exigimos TLS quando esse tráfego SAI da máquina — dentro
  // da rede interna do Coolify (nome de serviço, loopback, IP privado) ele não
  // passa por rede não confiável, e exigir TLS ali só quebraria o deploy.
  .refine(
    (v) =>
      !(
        v.NODE_ENV === 'production' &&
        v.REDIS_URL &&
        !v.REDIS_URL.startsWith('rediss://') &&
        !isInternalRedisHost(v.REDIS_URL)
      ),
    {
      path: ['REDIS_URL'],
      message:
        'REDIS_URL aponta para um host externo e precisa usar rediss:// em produção: o texto decifrado das mensagens trafega pelo pub/sub.',
    },
  )
  // Boot falha em vez de abrir CORS pra qualquer origem em produção: refletir a
  // Origin com `credentials: true` é configuração frouxa. Em prod exigimos uma
  // allowlist explícita. Em dev/test segue permissivo (sem a var) por conveniência.
  // Meio par não serve pra nada: com só o id a troca do code falha no Spotify,
  // com só o secret nem dá pra montar o authorize. Falhar no boot evita
  // descobrir isso no primeiro usuário que tentar vincular.
  .refine((v) => !!v.SPOTIFY_CLIENT_ID === !!v.SPOTIFY_CLIENT_SECRET, {
    path: ['SPOTIFY_CLIENT_SECRET'],
    message:
      'SPOTIFY_CLIENT_ID e SPOTIFY_CLIENT_SECRET andam juntos: defina os dois ou nenhum.',
  })
  .refine((v) => !(v.NODE_ENV === 'production' && !v.CORS_ALLOWED_ORIGINS), {
    path: ['CORS_ALLOWED_ORIGINS'],
    message:
      'CORS_ALLOWED_ORIGINS é obrigatório em produção (CSV de origens permitidas).',
  })
  // Fail-closed: em produção, /metrics não pode ficar aberto. Sem METRICS_TOKEN
  // o endpoint expõe a superfície da API (rotas, tráfego) sem auth. Exige o token
  // quando a coleta está ligada; para não expor, defina o token ou METRICS_ENABLED=false.
  .refine(
    (v) =>
      !(v.NODE_ENV === 'production' && v.METRICS_ENABLED && !v.METRICS_TOKEN),
    {
      path: ['METRICS_TOKEN'],
      message:
        'METRICS_TOKEN é obrigatório em produção com METRICS_ENABLED ligado (senão /metrics fica aberto). Defina o token ou METRICS_ENABLED=false.',
    },
  )
  // Fail-closed em TODOS os ambientes (não só produção): sem a KEK ativa nenhuma
  // mensagem pode ser cifrada nem lida. Falhar no boot é infinitamente melhor do
  // que subir e gravar conteúdo em claro — ou, pior, gravar cifrado com uma
  // chave que ninguém tem.
  .refine((v) => chatKeks.keks.has(v.CHAT_KEK_ACTIVE_VERSION), {
    path: ['CHAT_KEK_ACTIVE_VERSION'],
    message:
      'CHAT_KEK_V<n> é obrigatório para a CHAT_KEK_ACTIVE_VERSION escolhida (32 bytes em base64). Gere com: openssl rand -base64 32',
  })
  // As versões INATIVAS também precisam ser válidas: uma KEK antiga corrompida
  // só apareceria ao tentar ler uma mensagem velha, em produção, tarde demais.
  .refine(() => chatKeks.invalid.length === 0, {
    path: [chatKeks.invalid[0] ?? 'CHAT_KEK_V1'],
    message: `Não decodificam para 32 bytes em base64: ${chatKeks.invalid.join(', ')}`,
  })
  .parse(process.env)

const STORAGE_DRIVER: 'local' | 'r2' = parsed.STORAGE_DRIVER ?? 'r2'

export type CloudinaryCredentials = {
  cloudName: string
  apiKey: string
  apiSecret: string
}

// Legado: usado só pelo script de migração de assets do Cloudinary pro R2 (fase 3); remoção na fase 4.
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

export type R2Credentials = {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucketPublic: string
  bucketPrivate: string
  publicBaseUrl: string
}

export function resolveR2Credentials(): R2Credentials {
  const isProd = parsed.NODE_ENV === 'production'
  const accountId = isProd
    ? parsed.R2_ACCOUNT_ID_PROD
    : parsed.R2_ACCOUNT_ID_DEV
  const accessKeyId = isProd
    ? parsed.R2_ACCESS_KEY_ID_PROD
    : parsed.R2_ACCESS_KEY_ID_DEV
  const secretAccessKey = isProd
    ? parsed.R2_SECRET_ACCESS_KEY_PROD
    : parsed.R2_SECRET_ACCESS_KEY_DEV
  const bucketPublic = isProd
    ? parsed.R2_BUCKET_PUBLIC_PROD
    : parsed.R2_BUCKET_PUBLIC_DEV
  const bucketPrivate = isProd
    ? parsed.R2_BUCKET_PRIVATE_PROD
    : parsed.R2_BUCKET_PRIVATE_DEV
  const publicBaseUrl = isProd
    ? parsed.R2_PUBLIC_BASE_URL_PROD
    : parsed.R2_PUBLIC_BASE_URL_DEV

  if (
    !accountId ||
    !accessKeyId ||
    !secretAccessKey ||
    !bucketPublic ||
    !bucketPrivate ||
    !publicBaseUrl
  ) {
    const suffix = isProd ? 'PROD' : 'DEV'
    throw new Error(
      `R2 não configurado para ${parsed.NODE_ENV}. Defina R2_ACCOUNT_ID_${suffix}, R2_ACCESS_KEY_ID_${suffix}, R2_SECRET_ACCESS_KEY_${suffix}, R2_BUCKET_PUBLIC_${suffix}, R2_BUCKET_PRIVATE_${suffix} e R2_PUBLIC_BASE_URL_${suffix}.`,
    )
  }

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketPublic,
    bucketPrivate,
    // remove barra final para evitar `//` ao concatenar com o path do objeto
    publicBaseUrl: publicBaseUrl.replace(/\/$/, ''),
  }
}

export const env = {
  DATABASE_URL: parsed.DATABASE_URL,
  JWT_SECRET: parsed.JWT_SECRET,
  JWT_EXPIRES_IN: parsed.JWT_EXPIRES_IN,
  REFRESH_TOKEN_EXPIRES_IN: parsed.REFRESH_TOKEN_EXPIRES_IN,
  REFRESH_TOKEN_REUSE_GRACE_MS: parsed.REFRESH_TOKEN_REUSE_GRACE_MS,
  // CSV -> lista limpa, ou `undefined` quando não há origens configuradas.
  // CORS_ALLOWED_ORIGINS="" (string vazia, como no .env.example) precisa cair em
  // `undefined` — não em `[]`. Senão `origin: [] ?? true` no server.ts ficaria
  // `[]` (array vazio não é nullish), e o @fastify/cors bloquearia TODAS as
  // origens em dev. Contrato: ou lista não-vazia, ou undefined (= "não configurado").
  CORS_ALLOWED_ORIGINS: ((): string[] | undefined => {
    const list = parsed.CORS_ALLOWED_ORIGINS?.split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    return list && list.length > 0 ? list : undefined
  })(),
  TRUSTED_PROXIES: parsed.TRUSTED_PROXIES,
  PORT: parsed.PORT,
  NODE_ENV: parsed.NODE_ENV,
  PUBLIC_URL: parsed.PUBLIC_URL,
  SHARE_BASE_URL: parsed.SHARE_BASE_URL ?? parsed.PUBLIC_URL,
  REDIS_URL: parsed.REDIS_URL,
  RATE_LIMIT_ENABLED: parsed.RATE_LIMIT_ENABLED,
  RATE_LIMIT_MAX_FACTOR: parsed.RATE_LIMIT_MAX_FACTOR,
  RATE_LIMIT_WINDOW: parsed.RATE_LIMIT_WINDOW,
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
  ANTHROPIC_API_KEY: parsed.ANTHROPIC_API_KEY,
  SPOTIFY_CLIENT_ID: parsed.SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET: parsed.SPOTIFY_CLIENT_SECRET,
  SPOTIFY_REDIRECT_URI: parsed.SPOTIFY_REDIRECT_URI,
  SPOTIFY_TOP_TIME_RANGE: parsed.SPOTIFY_TOP_TIME_RANGE,
  SPOTIFY_SYNC_INTERVAL_MS: parsed.SPOTIFY_SYNC_INTERVAL_MS,
  SPOTIFY_SYNC_MAX_AGE_MS: parsed.SPOTIFY_SYNC_MAX_AGE_MS,
  SPOTIFY_SYNC_ENABLED: parsed.SPOTIFY_SYNC_ENABLED,
  APPLE_BUNDLE_ID: parsed.APPLE_BUNDLE_ID,
  APPLE_TEAM_ID: parsed.APPLE_TEAM_ID,
  ANDROID_PACKAGE_NAME: parsed.ANDROID_PACKAGE_NAME,
  ANDROID_CERT_SHA256: parsed.ANDROID_CERT_SHA256.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  APP_STORE_URL: parsed.APP_STORE_URL,
  PLAY_STORE_URL: parsed.PLAY_STORE_URL,
  FEATURED_RECONCILE_INTERVAL_MS: parsed.FEATURED_RECONCILE_INTERVAL_MS,
  FEATURED_RECONCILE_ENABLED: parsed.FEATURED_RECONCILE_ENABLED,
  PROMOTION_MONTHLY_LIMIT: parsed.PROMOTION_MONTHLY_LIMIT,
  PROMOTION_MAX_DURATION_DAYS: parsed.PROMOTION_MAX_DURATION_DAYS,
  RECURRENCE_RECONCILE_INTERVAL_MS: parsed.RECURRENCE_RECONCILE_INTERVAL_MS,
  RECURRENCE_RECONCILE_ENABLED: parsed.RECURRENCE_RECONCILE_ENABLED,
  STRIPE_SECRET_KEY: parsed.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: parsed.STRIPE_WEBHOOK_SECRET,
  STRIPE_PREMIUM_PRICE_ID: parsed.STRIPE_PREMIUM_PRICE_ID,
  STRIPE_CHECKOUT_SUCCESS_URL: parsed.STRIPE_CHECKOUT_SUCCESS_URL,
  STRIPE_CHECKOUT_CANCEL_URL: parsed.STRIPE_CHECKOUT_CANCEL_URL,
  STRIPE_CHECKOUT_ALLOWED_REDIRECT_HOSTS:
    parsed.STRIPE_CHECKOUT_ALLOWED_REDIRECT_HOSTS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  BILLING_WEBHOOK_RETENTION_DAYS: parsed.BILLING_WEBHOOK_RETENTION_DAYS,
  BILLING_WEBHOOK_RETENTION_CLEANUP_INTERVAL_MS:
    parsed.BILLING_WEBHOOK_RETENTION_CLEANUP_INTERVAL_MS,
  BILLING_WEBHOOK_RETENTION_CLEANUP_ENABLED:
    parsed.BILLING_WEBHOOK_RETENTION_CLEANUP_ENABLED,
  BILLING_SYNC_INTERVAL_MS: parsed.BILLING_SYNC_INTERVAL_MS,
  BILLING_SYNC_GRACE_MS: parsed.BILLING_SYNC_GRACE_MS,
  BILLING_ORPHAN_LOOKBACK_MS: parsed.BILLING_ORPHAN_LOOKBACK_MS,
  BILLING_SYNC_ENABLED: parsed.BILLING_SYNC_ENABLED,
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
  CHAT_KEK_ACTIVE_VERSION: parsed.CHAT_KEK_ACTIVE_VERSION,
  CHAT_PUSH_PREVIEW_ENABLED: parsed.CHAT_PUSH_PREVIEW_ENABLED,
  CHAT_EVIDENCE_CONTEXT_BEFORE: parsed.CHAT_EVIDENCE_CONTEXT_BEFORE,
  CHAT_EVIDENCE_CONTEXT_AFTER: parsed.CHAT_EVIDENCE_CONTEXT_AFTER,
  CHAT_EVIDENCE_RETENTION_DAYS: parsed.CHAT_EVIDENCE_RETENTION_DAYS,
  CHAT_EVIDENCE_CLEANUP_INTERVAL_MS: parsed.CHAT_EVIDENCE_CLEANUP_INTERVAL_MS,
  CHAT_EVIDENCE_CLEANUP_ENABLED: parsed.CHAT_EVIDENCE_CLEANUP_ENABLED,
  // Mapa versão → KEK já decodificada. Os refines acima garantem que toda chave
  // presente tem 32 bytes e que a ativa existe, então aqui não há caso de erro.
  CHAT_KEKS: chatKeks.keks,
  CHAT_KEK_REWRAP_INTERVAL_MS: parsed.CHAT_KEK_REWRAP_INTERVAL_MS,
  CHAT_KEK_REWRAP_ENABLED: parsed.CHAT_KEK_REWRAP_ENABLED,
  ACCOUNT_DELETION_GRACE_DAYS: parsed.ACCOUNT_DELETION_GRACE_DAYS,
  ACCOUNT_DELETION_INTERVAL_MS: parsed.ACCOUNT_DELETION_INTERVAL_MS,
  ACCOUNT_DELETION_ENABLED: parsed.ACCOUNT_DELETION_ENABLED,
  SUSPENSION_RECONCILE_INTERVAL_MS: parsed.SUSPENSION_RECONCILE_INTERVAL_MS,
  SUSPENSION_RECONCILE_ENABLED: parsed.SUSPENSION_RECONCILE_ENABLED,
  SPOT_LIFECYCLE_INTERVAL_MS: parsed.SPOT_LIFECYCLE_INTERVAL_MS,
  SPOT_LIFECYCLE_ENABLED: parsed.SPOT_LIFECYCLE_ENABLED,
  SPOT_RENEWAL_LEAD_MS: parsed.SPOT_RENEWAL_LEAD_MS,
  NOTIFICATIONS_ENABLED: parsed.NOTIFICATIONS_ENABLED,
  EXPO_ACCESS_TOKEN: parsed.EXPO_ACCESS_TOKEN,
  NOTIFY_RETENTION_DAYS: parsed.NOTIFY_RETENTION_DAYS,
  NOTIFY_RETENTION_CLEANUP_INTERVAL_MS:
    parsed.NOTIFY_RETENTION_CLEANUP_INTERVAL_MS,
  NOTIFY_RETENTION_CLEANUP_ENABLED: parsed.NOTIFY_RETENTION_CLEANUP_ENABLED,
  NOTIFY_MAX_RADIUS_KM: parsed.NOTIFY_MAX_RADIUS_KM,
  SPOT_MAX_RADIUS_KM: parsed.SPOT_MAX_RADIUS_KM,
  NOTIFY_LOCATION_TTL_DAYS: parsed.NOTIFY_LOCATION_TTL_DAYS,
  NOTIFY_LOCATION_CLEANUP_INTERVAL_MS:
    parsed.NOTIFY_LOCATION_CLEANUP_INTERVAL_MS,
  NOTIFY_LOCATION_CLEANUP_ENABLED: parsed.NOTIFY_LOCATION_CLEANUP_ENABLED,
  NOTIFY_FANOUT_BATCH_SIZE: parsed.NOTIFY_FANOUT_BATCH_SIZE,
  NOTIFY_RECEIPTS_DELAY_MS: parsed.NOTIFY_RECEIPTS_DELAY_MS,
  NOTIFY_RECEIPTS_INTERVAL_MS: parsed.NOTIFY_RECEIPTS_INTERVAL_MS,
  NOTIFY_RECEIPTS_ENABLED: parsed.NOTIFY_RECEIPTS_ENABLED,
} as const
