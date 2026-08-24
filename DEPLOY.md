# Deploy — Clubber Backend

Documento operacional para deploy em produção via **Coolify**. Não é tutorial —
assume familiaridade com o painel do Coolify e com o restante do `CLAUDE.md`.

## Arquitetura

- **CI/CD:** GitHub Actions builda a imagem (`linux/amd64`) e publica no GHCR
  com as tags `sha-<git-sha>` e `latest`. O workflow dispara um webhook do
  Coolify ao final para acionar o deploy.
- **App:** recurso Coolify do tipo *Docker Image*, apontando para a imagem do
  GHCR — **sem build no servidor**.
- **Postgres** e **Redis** são recursos Coolify **separados**, fora do stack do
  app, para ter backup gerenciado e ciclo de vida independente de um deploy da
  aplicação.
- **Postgres precisa ser a imagem `postgis/postgis:16-3.4`.** A imagem padrão
  `postgres` do Coolify não tem a extensão PostGIS. As migrations rodam
  `CREATE EXTENSION IF NOT EXISTS postgis` e `CREATE EXTENSION IF NOT EXISTS
  btree_gist`, que só funcionam se a extensão estiver disponível na imagem —
  sem isso o `migrate deploy` falha na primeira migration que usa PostGIS.
- **Migrations rodam no entrypoint do container** via `prisma migrate deploy`
  (nunca `migrate dev` — ver seção "Banco de dados" do `CLAUDE.md` sobre o
  drift das colunas geradas do PostGIS).

---

## 1. Variáveis de ambiente de produção

Fonte da verdade: [`src/lib/env.ts`](src/lib/env.ts) (schema Zod validado no
boot). Descrições cruzadas com [`.env.example`](.env.example).

`DATABASE_URL` e `REDIS_URL` devem apontar para os **hostnames internos** dos
recursos do Coolify (rede interna do Coolify, ex. `postgres-service:5432`,
`redis-service:6379`), nunca para endereço público — o Postgres/Redis não
devem ficar expostos à internet.

### 1.1. Obrigatórias sempre (boot falha sem elas, em qualquer ambiente)

| Variável | Descrição |
|---|---|
| `DATABASE_URL` | Connection string Postgres/PostGIS. Deve ser o hostname interno do recurso Postgres no Coolify. |
| `JWT_SECRET` | Segredo de assinatura dos JWTs de sessão. Gerar com `openssl rand -hex 32`; nunca reaproveitar valor de dev. |
| `STRIPE_SECRET_KEY` | Chave secreta Stripe (`sk_live_...` em produção). Sem `.optional()` no schema — obrigatória mesmo com billing pouco usado. |
| `STRIPE_WEBHOOK_SECRET` | Segredo do webhook Stripe (`whsec_...`). |
| `STRIPE_PREMIUM_PRICE_ID` | ID do Price recorrente do plano premium (`price_...`). |
| `STRIPE_CHECKOUT_SUCCESS_URL` | URL de retorno de sucesso do checkout web. |
| `STRIPE_CHECKOUT_CANCEL_URL` | URL de retorno de cancelamento do checkout web. |
| `CHAT_KEK_V1` | Chave mestra (KEK) do envelope encryption do chat: 32 bytes em base64 (`openssl rand -base64 32`). Um `.refine()` exige a KEK da versão ativa **em todo ambiente**, sem gate por `NODE_ENV` — sem ela o boot falha de propósito, porque nenhuma mensagem poderia ser escrita nem lida. |

> As cinco variáveis de Stripe são obrigatórias no schema base (`z.string()`
> sem `.optional()`/`.default()`), não têm gate por `NODE_ENV` — o boot falha
> em qualquer ambiente sem elas, inclusive se a feature de billing não for
> usada ainda em produção.

> **A KEK não tem recuperação.** Perdê-la torna todo o histórico de chat
> ciphertext inútil — não há reset, backup de conveniência nem caminho de
> suporte. É a única variável deste arquivo com essa propriedade: perder o
> `JWT_SECRET` derruba as sessões **e** torna todo `mfaSecret` indecifrável
> (a chave de cifra do MFA é derivada dele via HKDF, ver `src/lib/mfa.ts`),
> mas dali o usuário recadastra o MFA — da KEK não se volta. Guarde-a no
> gerenciador de segredos, com backup próprio e versionado, **fora** do
> arquivo de env da máquina. O procedimento completo de geração, custódia e
> rotação está em [docs/GESTAO_DE_CHAVES.md](docs/GESTAO_DE_CHAVES.md).
>
> Rotação: gere a `CHAT_KEK_V2`, **mantenha a V1 no ambiente**, aponte
> `CHAT_KEK_ACTIVE_VERSION=2` e só remova a V1 quando o reconciler de rewrap
> zerar os pendentes — as DEKs antigas seguem envelopadas pela V1 até lá.

### 1.2. Obrigatórias condicionalmente em produção (`NODE_ENV=production`)

Validadas pelos `.refine(...)` no fim do schema (`src/lib/env.ts:359-408`).
Falha de boot, não degradação silenciosa.

| Variável | Obrigatória quando | Descrição |
|---|---|---|
| `CORS_ALLOWED_ORIGINS` | Sempre em produção | CSV de origens permitidas no CORS. Sem ela, o boot falha — em prod nunca se reflete `Origin` com `credentials: true`. Em dev/test, vazio = reflete a Origin da requisição. |
| `EMAIL_DRIVER` | Sempre em produção (não pode ser `log`) | Driver de envio de e-mail. `log` só imprime o OTP no terminal — proibido em prod (vazaria o código de reset de senha nos logs). Definir `resend`. |
| `RESEND_API_KEY` | Quando `EMAIL_DRIVER=resend` | Chave da API do Resend. Como produção exige `EMAIL_DRIVER=resend`, esta chave é obrigatória em produção por consequência. |
| `REDIS_URL` | Quando `NOTIFICATIONS_ENABLED=true` em produção | A fila de notificações (BullMQ) roda sobre o Redis. Sem ela, o fan-out falharia silenciosamente — por isso o boot barra. Aponte para o hostname interno do recurso Redis. |
| `METRICS_TOKEN` | Quando `METRICS_ENABLED=true` (default) em produção | Token Bearer exigido em `/metrics`. Sem ele, o endpoint exporia rotas/tráfego sem autenticação — boot falha. Alternativa: `METRICS_ENABLED=false`. |

### 1.3. Obrigatórias por uso de feature (não validadas no boot — falham em runtime)

Não têm `.refine()` no `env.ts`; a ausência não impede o app de subir, mas
quebra a funcionalidade correspondente na primeira chamada.

| Variável | Obrigatória quando | Descrição |
|---|---|---|
| `R2_ACCOUNT_ID_PROD`, `R2_ACCESS_KEY_ID_PROD`, `R2_SECRET_ACCESS_KEY_PROD`, `R2_BUCKET_PUBLIC_PROD`, `R2_BUCKET_PRIVATE_PROD`, `R2_PUBLIC_BASE_URL_PROD` | `STORAGE_DRIVER=r2` em produção | `resolveR2Credentials()` (`src/lib/env.ts`) lança erro em runtime — na primeira operação de upload, não no boot — se alguma faltar em `NODE_ENV=production`. Configure as seis antes do primeiro deploy com `STORAGE_DRIVER=r2`. |
| `GOOGLE_PLACES_API_KEY` | Uso de `POST /spots/suggestions` | Sem ela, o endpoint responde 503 (degradação graciosa documentada no `.env.example`). |
| `ANTHROPIC_API_KEY` | Copy/ranking de sugestões de spot via IA | Sem ela, cai num template determinístico — degradação graciosa, não é hard-fail. |
| `GOOGLE_CLIENT_ID` | Login social via Google | Sem ela, login com Google falha nas chamadas que dependem do client id. |
| `EXPO_ACCESS_TOKEN` | `NOTIFICATIONS_ENABLED=true` **e** "Enhanced Security for Push Notifications" ligado no painel Expo/EAS | Sem "Enhanced Security" ligado, não é necessário. Com ela ligada e sem o token, os envios de push passam a falhar (ver `RELEASE_CHECKLIST.md`). |

### 1.4. Opcionais com default (comportamento padrão documentado)

Config geral, timings de reconciler e observabilidade — todas com `.default()`
no schema, seguras para deixar sem definir em produção salvo necessidade
específica de ajuste.

| Variável | Default | Descrição |
|---|---|---|
| `PORT` | `3333` | Porta HTTP do servidor. |
| `NODE_ENV` | `development` | **Definir explicitamente `production`** — é o que ativa os `.refine()` da seção 1.2. |
| `PUBLIC_URL` | `http://localhost:3333` | URL pública da API (links absolutos, ex. uploads locais). Ajustar para o domínio real. |
| `LOG_LEVEL` | `info` | `trace\|debug\|info\|warn\|error\|fatal\|silent`. |
| `JWT_EXPIRES_IN` | `15m` | Validade do access token. |
| `REFRESH_TOKEN_EXPIRES_IN` | `90d` | Validade do refresh token. |
| `REFRESH_TOKEN_REUSE_GRACE_MS` | `30000` | Janela de carência para reuso benigno de refresh token rotacionado. |
| `APPLE_BUNDLE_ID` | `com.netobonato.clubber` | Audience da verificação do identityToken do "Sign in with Apple" (bundle id do app iOS). O default já é o bundle id real; sem secret — a verificação usa o JWKS público da Apple. Só definir para apontar outro app. |
| `TRUSTED_PROXIES` | `` (vazio) | CSV de IPs/CIDRs de proxies confiáveis (LB/CDN na frente). Recomendado configurar em produção para o rate-limit enxergar o IP real do cliente via `X-Forwarded-For`. |
| `RATE_LIMIT_ENABLED` | `true` | Master switch do rate-limit. |
| `RATE_LIMIT_MAX_FACTOR` | `1` | Multiplicador dos limites de todas as rotas. |
| `RATE_LIMIT_WINDOW` | `1 minute` | Janela global do rate-limit. |
| `STORAGE_DRIVER` | `r2` | `r2\|local`. Em produção manter `r2` (ver 1.3). |
| `UPLOADS_DIR` | `./uploads` | Só relevante com `STORAGE_DRIVER=local`. |
| `R2_PUBLIC_BASE_URL_DEV` / `_PROD` | — | Public Development URL do bucket (`https://pub-xxxx.r2.dev`) em dev, ou custom domain em prod. Só relevante com `STORAGE_DRIVER=r2` (ver 1.3). |
| `CHAT_USER_STORAGE_QUOTA_BYTES` | `1073741824` (1 GB) | Cota de mídia de chat por usuário. |
| `EMAIL_FROM` | `Clubber <no-reply@clubber.app>` | Remetente dos e-mails transacionais. |
| `PASSWORD_RESET_CODE_TTL_MINUTES` | `15` | Validade do OTP de recuperação. |
| `PASSWORD_RESET_MAX_ATTEMPTS` | `5` | Tentativas por código. |
| `PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS` | `60` | Cooldown entre solicitações de código. |
| `PASSWORD_RESET_CLEANUP_INTERVAL_MS` / `PASSWORD_RESET_CLEANUP_ENABLED` | `3600000` / `true` | Expurgo (LGPD) de códigos usados/expirados. |
| `STRIPE_CHECKOUT_ALLOWED_REDIRECT_HOSTS` | `localhost:3000,localhost:3333` | **Ajustar em produção** — CSV de hosts aceitos no override de success/cancel URL (anti open-redirect). |
| `BILLING_WEBHOOK_RETENTION_DAYS` / `..._CLEANUP_INTERVAL_MS` / `..._CLEANUP_ENABLED` | `90` / `3600000` / `true` | Retenção (LGPD) de `webhook_events`. |
| `BILLING_SYNC_INTERVAL_MS` / `BILLING_SYNC_GRACE_MS` / `BILLING_SYNC_ENABLED` | `3600000` / `21600000` / `true` | Re-sync de assinaturas com o Stripe. |
| `SENTRY_DSN` | — | Rastreio de erros. Vazio = desligado. |
| `OTEL_ENABLED` / `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_SERVICE_NAME` | `false` / `http://localhost:4318` / `clubber-backend` | OpenTelemetry — só ativa com `OTEL_ENABLED=true` e endpoint definido. |
| `LOKI_URL` | — | Logs centralizados. Sem URL, só stdout. |
| `METRICS_ENABLED` | `true` | Expõe `/metrics`. Ver `METRICS_TOKEN` na seção 1.2 quando ligado em produção. |
| `FEATURED_RECONCILE_INTERVAL_MS` / `..._ENABLED` | `300000` / `true` | Reconciler de featured events. |
| `PROMOTION_MONTHLY_LIMIT` / `PROMOTION_MAX_DURATION_DAYS` / `PROMOTION_DIGEST_*` | vários | Regras de promoção/destaque (RF11.4+). |
| `RECURRENCE_RECONCILE_INTERVAL_MS` / `..._ENABLED` | `21600000` / `true` | Reposição de ocorrências de eventos recorrentes. |
| `ACCOUNT_DELETION_GRACE_DAYS` / `..._INTERVAL_MS` / `..._ENABLED` | `30` / `3600000` / `true` | Exclusão de conta (soft-delete + anonimização). |
| `SUSPENSION_RECONCILE_INTERVAL_MS` / `..._ENABLED` | `3600000` / `true` | Expira suspensões temporárias vencidas. |
| `SPOT_LIFECYCLE_INTERVAL_MS` / `SPOT_RENEWAL_LEAD_MS` / `..._ENABLED` | `3600000` / `3600000` / `true` | Lifecycle de spots (lembrete + limpeza). |
| `SPOT_MAX_RADIUS_KM` | `50` | Teto do raio de recomendação de spots. |
| `NOTIFICATIONS_ENABLED` | `false` | Master switch de push + in-app. Ver `REDIS_URL` obrigatório na seção 1.2 quando ligado em produção. |
| `NOTIFY_RETENTION_DAYS` / `..._CLEANUP_INTERVAL_MS` / `..._CLEANUP_ENABLED` | `180` / `3600000` / `true` | Retenção (LGPD) de notificações in-app. |
| `NOTIFY_MAX_RADIUS_KM` | `50` | Teto do raio de push de proximidade. |
| `NOTIFY_LOCATION_TTL_DAYS` / `..._CLEANUP_INTERVAL_MS` / `..._CLEANUP_ENABLED` | `90` / `3600000` / `true` | Frescor/expurgo da localização usada para push de proximidade. |
| `NOTIFY_FANOUT_BATCH_SIZE` | `500` | Página da query invertida de destinatários. |
| `NOTIFY_RECEIPTS_DELAY_MS` / `..._INTERVAL_MS` / `..._ENABLED` | `900000` / `300000` / `true` | Checagem de receipts do Expo Push. |

---

## 2. Rollback por tag de imagem

Cada push gera uma imagem `ghcr.io/<org>/<repo>:sha-<git-sha>` além de
`:latest`. Para reverter um deploy problemático:

1. No recurso *Docker Image* do app no Coolify, trocar a tag configurada de
   `latest` (ou da tag ruim) para `sha-<git-sha-anterior>` — usar o SHA do
   último commit conhecido como estável (`git log` no branch `main`).
2. Redeployar o recurso a partir da nova tag (o Coolify puxa a imagem correta
   do GHCR).
3. Confirmar `/health/ready` retornando 200 após o redeploy.

**Importante — rollback de imagem não reverte migrations de banco.** O
`prisma migrate deploy` já rodou no entrypoint do deploy anterior e as
migrations aplicadas continuam aplicadas; voltar a tag da imagem apenas troca
o código da aplicação, não o estado do schema.

- Se a migration do deploy revertido **não foi destrutiva** (ex.: só adicionou
  coluna/tabela nova que o código anterior ignora), o rollback de imagem
  costuma bastar.
- Se a migration foi **destrutiva** (`DROP COLUMN`, `DROP TABLE`, alteração de
  tipo com perda de dados), o rollback da aplicação **não é suficiente** — é
  necessário restaurar o backup do Postgres a partir do ponto anterior à
  migration.
- **Isso ainda não está resolvido como procedimento formal.** O
  `RELEASE_CHECKLIST.md` tem o item aberto "Documentar rollback de migration"
  (P0, seção "Containerização & Deploy") — não existe hoje um script de
  migration reversa nem um runbook de restore testado. Até esse item ser
  fechado, tratar toda migration destrutiva em produção como evento manual de
  alto risco, com backup confirmado *antes* do deploy.

---

## 3. Checklist do primeiro deploy

- [ ] **Criar o recurso Postgres no Coolify usando a imagem `postgis/postgis:16-3.4`**
      (não a imagem `postgres` padrão do Coolify — ela não tem PostGIS e o
      `migrate deploy` falha nas migrations que fazem `CREATE EXTENSION
      postgis`/`btree_gist`).
- [ ] **Criar o recurso Redis no Coolify** (imagem padrão está ok).
- [ ] **Confirmar que o app e os dois recursos de banco estão na mesma rede
      interna do Coolify** — `DATABASE_URL`/`REDIS_URL` do app devem resolver
      pelo hostname interno, sem expor Postgres/Redis publicamente.
- [ ] **Configurar as credenciais do registry privado GHCR** no recurso
      *Docker Image* do Coolify (login com PAT/token com escopo `read:packages`
      contra `ghcr.io`), para o Coolify conseguir puxar a imagem publicada
      pelo workflow.
- [ ] **Gerar a KEK do chat e guardá-la ANTES de cadastrar** — `openssl rand
      -base64 32`, uma chave distinta por ambiente, guardada nas três cópias
      previstas em [docs/GESTAO_DE_CHAVES.md](docs/GESTAO_DE_CHAVES.md)
      (cofre, Coolify, break-glass offline). É o único segredo daqui sem
      recuperação: cadastrar sem ter guardado é apostar o histórico de chat
      inteiro na sobrevivência do painel do Coolify.
- [ ] **Preencher todas as variáveis de ambiente** da seção 1 — checar em
      especial as obrigatórias de produção (1.1 e 1.2) e as credenciais R2
      `_PROD` (1.3), já que a ausência delas só quebra em runtime, não no
      boot.
- [ ] **Configurar o webhook de deploy do Coolify** como último step do
      workflow do GitHub Actions.
- [ ] **Disparar o primeiro deploy e acompanhar o log do `prisma migrate
      deploy` ao vivo no entrypoint.** São 67 migrations partindo de um banco
      zerado — confirmar que todas aplicam sem erro antes de considerar o
      deploy concluído (não assumir sucesso só porque o container ficou "up").
- [ ] **Validar `GET /health/ready` respondendo `200`** após o boot completo —
      cobre conectividade real com Postgres e Redis, não só o processo vivo
      (`/health/live` é liveness pura, não serve para validar essa etapa).
