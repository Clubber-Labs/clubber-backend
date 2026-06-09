# Release Checklist — ConnectAI Backend

> Plano de robustez / prontidão para produção, levantado a partir de uma varredura
> completa do código (módulos, lib/infra, Prisma, CI e testes).
> Cada item aponta **o quê**, **por quê**, **onde** (`arquivo:linha`) e a **ferramenta sugerida**.
>
> **Como usar:** itens marcados `[ ]` ainda precisam ser feitos. Implementar por
> prioridade (P0 → P1 → P2). Cada bloco pode virar uma branch `feat/`, `fix/` ou
> `chore/` própria, com testes verdes antes do PR (ver regra de conclusão no CLAUDE.md).
>
> **Legenda de severidade:** 🔴 bloqueante · 🟡 importante · 🟢 melhoria

---

## ✅ O que já está robusto (não refazer)

- [x] Error handler central que não vaza stack/SQL em prod — [server.ts:43-70](src/server.ts#L43-L70)
- [x] Mapeamento de unique constraint do Prisma (P2002) → 409 amigável — [lib/errors.ts](src/lib/errors.ts)
- [x] Graceful shutdown (SIGINT/SIGTERM) fechando app + Redis — [server.ts:152-170](src/server.ts#L152-L170)
- [x] Health check de DB + Redis com 503 quando degradado — [health.routes.ts](src/modules/health/health.routes.ts)
- [x] Redis best-effort: cache e realtime degradam pra `null` sem quebrar o REST — [lib/cache.ts](src/lib/cache.ts), [lib/realtime.ts](src/lib/realtime.ts)
- [x] Env validado com Zod no boot — [lib/env.ts](src/lib/env.ts)
- [x] CI completa: lint (Biome) + build + testes com Postgres/Redis reais + `pnpm audit` + Gitleaks — [.github/workflows/ci.yml](.github/workflows/ci.yml)
- [x] Testes de integração em **todos os 17 módulos** contra banco real, com guardas anti-prod no setup — [src/test/](src/test/)
- [x] TypeScript `strict: true` — [tsconfig.json](tsconfig.json)
- [x] Paginação por cursor na maioria das listagens; feed com cursor estável (score+id+relógio de ranking) — [feed.service.ts](src/modules/feed/feed.service.ts)
- [x] PostGIS com índice GIST em `location` para queries espaciais — [lib/spatial.ts](src/lib/spatial.ts)
- [x] Upload valida mimetype (whitelist) e tamanho (5MB) — [lib/uploads.ts](src/lib/uploads.ts), [server.ts:83-87](src/server.ts#L83-L87)
- [x] Idempotência já correta em: attendance (upsert), reactions (create→P2002→find), invites (`skipDuplicates`), DM (race fix no P2002)

---

## 🔴 P0 — Bloqueadores de produção

### Observabilidade

- [ ] **🔴 Ligar o logger do Fastify (Pino).** Hoje o app sobe com `fastify()` sem opção de logger → no Fastify 5 isso é `logger: false`. O `request.log.error({ err }, 'Unhandled error')` do error handler **não vai pra lugar nenhum** — estamos cegos em prod.
  - Onde: [server.ts:38](src/server.ts#L38)
  - Ferramenta: Pino (já vem embutido no Fastify). Configurar níveis por `NODE_ENV`, `requestId`, `redact` de campos sensíveis (`authorization`, `password`, `token`).
  - Trocar os `console.log/warn` espalhados por `app.log` / `request.log` — ex: [lib/redis.ts:9-11](src/lib/redis.ts#L9-L11), [lib/realtime.ts:23-24](src/lib/realtime.ts#L23-L24), [server.ts:173](src/server.ts#L173), reconciler.
- [ ] **🔴 Error tracking.** Capturar exceções não tratadas e enviá-las pra um agregador.
  - Ferramenta: Sentry (`@sentry/node`) ou similar. Plugar no error handler ([server.ts:63](src/server.ts#L63)) e em `process.on('unhandledRejection'/'uncaughtException')`.

### Containerização & Deploy

- [ ] **🔴 Criar Dockerfile do app.** Existe `docker-compose.yml` só pra infra local (Postgres+Redis), mas **não há imagem da aplicação** → deploy não é reproduzível.
  - Onde: raiz do projeto (criar `Dockerfile` + `.dockerignore`)
  - Sugestão: multi-stage (build com devDeps → runtime slim só com `dist/` + prod deps), `node dist/server.js`, usuário não-root, `HEALTHCHECK` apontando pra `/health`.
- [ ] **🔴 Estratégia de migration em produção.** Não existe script de deploy de migration no `package.json` (CI usa `prisma migrate deploy` direto). Definir que `prisma migrate deploy` roda no boot/entrypoint do container, nunca `migrate dev`.
  - Onde: [package.json](package.json) (adicionar `db:migrate:deploy`), entrypoint do Dockerfile.
- [ ] **🟡 Documentar rollback de migration.** Não há estratégia de rollback documentada. Definir procedimento (migration reversa manual / restore de backup).

### Banco — pool & índices

- [ ] **🔴 Configurar o Prisma Client.** Hoje é `new PrismaClient()` sem nada — pool default, sem log, sem timeout. Sob carga o pool pequeno vira gargalo.
  - Onde: [lib/prisma.ts:3](src/lib/prisma.ts#L3)
  - Ação: definir `connection_limit`/`pool_timeout` via `DATABASE_URL`, habilitar `log` (warn/error) ligado ao Pino, e `transactionOptions` (timeout) coerente.
- [ ] **🔴 Índices em foreign keys de ordenação/filtro.** Várias FKs muito usadas em `where`/`orderBy` estão sem índice → risco de full scan conforme a base cresce.
  - `Event.authorId`, `Post.authorId`, `Comment.authorId` — sem `@@index`
  - Onde: [prisma/schema.prisma](prisma/schema.prisma)
  - Ação: adicionar índices compostos coerentes com os acessos (ex: `@@index([authorId, createdAt])`).

### Segurança

- [ ] **🔴 Travar CORS em produção.** `origin: true` reflete **qualquer** origem.
  - Onde: [server.ts:72-76](src/server.ts#L72-L76)
  - Ação: allowlist por env (`CORS_ORIGINS`), mantendo `true` só em dev.
- [ ] **🟡 Adicionar security headers.** Sem helmet → faltam CSP, X-Frame-Options, HSTS, etc.
  - Ferramenta: `@fastify/helmet`. Registrar em [server.ts](src/server.ts).
- [ ] **🟡 Rate-limit global + reforço no auth.** Está `global: false` (só opt-in). Rotas como `GET /events`, `POST /attendances` ficam sem teto.
  - Onde: [server.ts:78-81](src/server.ts#L78-L81)
  - Ação: definir um default global sensato e limites mais agressivos nas rotas de auth (login, social-auth) contra brute force.
- [ ] **🟡 Limites de multipart.** Falta `maxFiles`/`maxFields` → DoS por muitos arquivos numa request.
  - Onde: [server.ts:83-87](src/server.ts#L83-L87)
- [ ] **🟡 Ligar "Enhanced Security for Push Notifications" no Expo + setar `EXPO_ACCESS_TOKEN`.** Por padrão o Expo Push API aceita enviar push pra qualquer device só com o push token, **sem autenticação** — se um token vazar, dá pra spammar os usuários. Em produção (com push ligado), ligar a segurança reforçada no painel Expo e definir o `EXPO_ACCESS_TOKEN`, que o backend passa a enviar em cada request.
  - Por quê: sem isso, qualquer um com o push token de um usuário consegue enviar notificação; com a segurança ligada mas **sem** o token no backend, os envios passam a **falhar**.
  - Onde: gerar em expo.dev (Account Settings → Access Tokens) e ligar a opção em *projeto → settings*; consumido em [lib/push/expo-push.service.ts](src/lib/push/expo-push.service.ts) (`new Expo({ accessToken })`) via env `EXPO_ACCESS_TOKEN` ([lib/env.ts](src/lib/env.ts)).
  - Escopo: só relevante quando `NOTIFICATIONS_ENABLED=true`. Em dev pode ficar vazio.

---

## 🟡 P1 — Confiabilidade

### Fila de jobs assíncronos (decisão: BullMQ, não RabbitMQ)

- [ ] **🟡 Substituir o reconciler in-process por uma fila.** O reconciler de featured events roda com `setInterval` no processo: roda em **toda** instância (sem leader election → trabalho duplicado em deploy multi-instância), sem retry e sem visibilidade.
  - Onde: [featured-events.reconciler.ts](src/modules/featured-events/featured-events.reconciler.ts), disparado em [server.ts:174-176](src/server.ts#L174-L176)
  - **Ferramenta: BullMQ** (sobre o Redis que já existe). Dá retry com backoff, jobs repetíveis (substitui o `setInterval`), delayed jobs e dead-letter — sem subir broker novo.
  - **Por que não RabbitMQ:** só compensaria numa arquitetura multi-serviço com roteamento/exchanges e múltiplos consumidores independentes. Pra um backend monolítico único, é peso operacional que o BullMQ resolve sem infra extra. Reavaliar se/quando quebrar em serviços.
  - Candidatos a virar job: reconcile de featured, processamento de imagem (sharp/Cloudinary), fan-out de notificações, pré-cálculo/aquecimento de feed, processamento de reports.

### Resiliência em chamadas externas

- [ ] **🟡 Timeout + retry no Cloudinary.** `upload_stream` sem timeout nem retry → request pode pendurar se o Cloudinary travar.
  - Onde: [lib/storage/cloudinary-storage.service.ts](src/lib/storage/cloudinary-storage.service.ts)
- [ ] **🟡 Timeout no OAuth (Google/Facebook).** `verifyIdToken` e o `fetch` da Graph API sem timeout → social login pendura se o provedor estiver lento.
  - Onde: [social-auth.providers.ts](src/modules/social-auth/social-auth.providers.ts)
  - Ação: `AbortController` com timeout + retry com backoff nas chamadas externas.
- [ ] **🟢 Circuit breaker** nas bordas externas (Cloudinary, OAuth) pra não empilhar requests contra serviço caído.
  - Ferramenta: `cockatiel` ou `opossum`.

### Integridade de dados

- [ ] **🟡 Idempotência em comments e posts.** `create()` puro, sem dedup → retry do cliente duplica conteúdo.
  - Onde: [comments.repository.ts](src/modules/comments/comments.repository.ts), [posts.repository.ts](src/modules/posts/posts.repository.ts)
  - Ação: avaliar Idempotency-Key header ou chave de dedup por (autor + conteúdo + janela curta).
- [ ] **🟡 Atomicidade upload + DB.** Troca de avatar / imagem de evento faz upload externo → update no DB → cleanup, sem atomicidade real (só try/catch). Falha no meio deixa imagem órfã ou registro inconsistente.
  - Onde: [users.service.ts (changeUserAvatar)](src/modules/users/users.service.ts), [events.service.ts (addEventImage)](src/modules/events/events.service.ts)
  - Ação: reordenar (DB primeiro com URL prevista, ou upload→DB com job de limpeza de órfãos) e/ou registrar uploads pendentes pra GC posterior.
- [ ] **🟡 Query sem limite em attendances.** `findMany()` sem `take` → evento com milhares de presenças retorna tudo.
  - Onde: [attendance.repository.ts](src/modules/attendance/attendance.repository.ts)
  - Ação: paginar/limitar como nas outras listagens.

### Cache

- [ ] **🟢 Proteção contra cache stampede.** Cache é best-effort (bom), mas sem single-flight/lock: num miss concorrido várias requests recalculam em paralelo.
  - Onde: [lib/cache.ts](src/lib/cache.ts)
  - Ação: coalescing (single-flight) por chave e/ou jitter no TTL.

---

## 🟢 P2 — Hardening & escala

- [ ] **🟢 Métricas.** Expor `/metrics` (latência, taxa de erro, pool do Prisma, profundidade da fila BullMQ).
  - Ferramenta: `prom-client` (+ Grafana) ou OpenTelemetry.
- [ ] **🟢 Tracing distribuído.** OpenTelemetry pra rastrear request → service → DB/Redis/externos.
- [ ] **🟢 Separar liveness de readiness.** `/health` hoje é readiness (checa deps). Adicionar `/live` barato (processo vivo) pro orquestrador não reiniciar o pod só porque o Redis piscou.
  - Onde: [health.routes.ts](src/modules/health/health.routes.ts)
- [ ] **🟢 Upgrade do realtime do chat.** Pub/sub é fire-and-forget (sem replay, sem entrega offline garantida) e sem heartbeat/ping-pong no WebSocket. DB já é a fonte da verdade, então é refinamento.
  - Onde: [chat.gateway.ts](src/modules/chat/chat.gateway.ts), [lib/realtime.ts](src/lib/realtime.ts)
  - Ação (se necessário): Redis Streams + consumer groups; heartbeat no gateway.
- [ ] **🟢 JWT fora da query string no WebSocket.** Os gateways autenticam via `?token=` na URL — o token vaza em access logs de proxy/nginx e no histórico do browser. Não é regressão (padrão herdado do chat), mas vale migrar.
  - Onde: [chat.gateway.ts](src/modules/chat/chat.gateway.ts), [notifications.gateway.ts](src/modules/notifications/notifications.gateway.ts)
  - Ação: autenticar via `Sec-WebSocket-Protocol` (subprotocolo) ou cookie HttpOnly, não na URL.
- [ ] **🟢 Estratégia de soft-delete consistente.** Só `Message` tem `deletedAt`; o resto é hard-delete. Definir política (auditoria? recuperação?).
  - Onde: [prisma/schema.prisma](prisma/schema.prisma)
- [ ] **🟢 Pre-commit hooks.** Sem husky/lint-staged → lint/format só pegam no CI.
  - Ferramenta: `husky` + `lint-staged` rodando `biome check` no staged.
- [ ] **🟢 Teste de carga / baseline de performance.** Não há teste de carga → limites de escala desconhecidos.
  - Ferramenta: k6 ou autocannon nas rotas quentes (feed, events, chat).
- [ ] **🟢 Matriz de versões do Node no CI.** Hoje testa só Node 22.
  - Onde: [.github/workflows/ci.yml](.github/workflows/ci.yml)
- [ ] **🟢 Cache de checks de visibilidade.** `profile-visibility` e `event-filters` fazem query ao DB a cada request, sem cache.
  - Onde: [lib/profile-visibility.ts](src/lib/profile-visibility.ts), [lib/event-filters.ts](src/lib/event-filters.ts)

---

## Ordem sugerida de execução

1. **Observabilidade primeiro** (Pino + Sentry) — barato e desbloqueia diagnosticar todo o resto.
2. **Deploy** (Dockerfile + migrate deploy) — pré-requisito pra qualquer prod.
3. **Banco** (pool + índices em FKs) — evita degradação silenciosa sob carga.
4. **Segurança** (CORS allowlist, helmet, rate-limit global).
5. **BullMQ** substituindo o reconciler — base pra todo trabalho assíncrono futuro.
6. Resiliência (timeouts/retries), idempotência, atomicidade.
7. P2 conforme a escala exigir.

> **Regra de conclusão (CLAUDE.md):** cada item só está pronto com `pnpm test` inteiro verde.
> Fixes de robustez devem vir com teste que reproduz o cenário (ex: timeout simulado,
> retry duplicado, falha de Redis), não só o happy path.
