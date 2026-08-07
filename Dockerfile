# Imagem da aplicação (Fastify) — usada tanto no teste de escala horizontal
# local (load-tests/, profile `cluster` do compose, NODE_ENV=development)
# quanto como artefato de produção no Coolify (NODE_ENV=production). Mesmo
# artefato para os dois: NÃO fixe NODE_ENV aqui, ele vem do ambiente.
# Multi-stage: compila o TS e gera o Prisma Client no build, e a imagem final
# só carrega node_modules + dist.
#
# NOTA: sem `pnpm prune --prod` — o logger usa `pino-pretty` (devDependency)
# quando NODE_ENV != production, e o profile `cluster` local depende disso.

# ── build ─────────────────────────────────────────────────────────────────────
FROM node:24-slim AS build
WORKDIR /app
# openssl aqui também: o `prisma generate` detecta a versão do OpenSSL para
# escolher o query engine. Sem ele a detecção erra (gera p/ openssl-1.1.x) e o
# client não acha o engine no runtime, que tem 3.0.x — toda query falha.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
# Instala deps com o lockfile congelado (cache de camada enquanto não mudar).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile
# Código + gera o Prisma Client + compila (tsc -> dist).
COPY . .
RUN pnpm db:generate && pnpm build
# NÃO rodar `pnpm prune --prod` aqui: o mesmo artefato roda com NODE_ENV=
# development (local) ou production (Coolify), e o logger usa `pino-pretty`
# (devDependency) sempre que NODE_ENV != production. Prune quebraria o boot local.

# ── runtime ───────────────────────────────────────────────────────────────────
FROM node:24-slim AS runtime
WORKDIR /app
# openssl: runtime do query engine do Prisma. ca-certificates: TLS de saída.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# Usuário não-root criado antes dos COPY porque o --chown abaixo exige que ele exista.
RUN addgroup --system appgroup \
  && adduser --system --ingroup appgroup appuser \
  && mkdir -p /app/uploads \
  && chown -R appuser:appgroup /app/uploads
# --chown: o CLI do Prisma exige escrita no diretório de engines antes de rodar o
# `migrate deploy` do entrypoint — copiado como root, ele falha sob USER appuser.
COPY --from=build --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
COPY --chmod=755 docker-entrypoint.sh ./docker-entrypoint.sh
USER appuser
EXPOSE 3333
# node -e com fetch (nativo no Node 24) em vez de curl/wget: a base slim não traz
# nenhum dos dois, e evita puxar mais um pacote via apt só para o healthcheck.
# --start-period generoso: no primeiro boot o entrypoint roda as 68 migrations
# antes do server responder.
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3333)+'/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
