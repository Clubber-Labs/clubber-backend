# Imagem da aplicação (Fastify) — usada para o teste de escala horizontal local
# (load-tests/). Multi-stage: compila o TS e gera o Prisma Client no build, e a
# imagem final só carrega node_modules + dist.
#
# NOTA: roda em NODE_ENV=development (definido no compose). Não fixe production
# aqui — o env.ts trava o boot em production sem credenciais de e-mail/Cloudinary.

# ── build ─────────────────────────────────────────────────────────────────────
FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable
# Instala deps com o lockfile congelado (cache de camada enquanto não mudar).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile
# Código + gera o Prisma Client + compila (tsc -> dist).
COPY . .
RUN pnpm db:generate && pnpm build
# NÃO rodar `pnpm prune --prod` aqui: a imagem sobe em NODE_ENV=development (a
# production tropeçaria nas guards do env.ts — Stripe/Cloudinary/e-mail), e o
# logger usa `pino-pretty` (devDependency) nesse modo. Prune quebraria o boot.

# ── runtime ───────────────────────────────────────────────────────────────────
FROM node:24-slim AS runtime
WORKDIR /app
# openssl: runtime do query engine do Prisma. ca-certificates: TLS de saída.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
# Roda como usuário não-root (boa prática); só o diretório de uploads precisa ser
# gravável pelo app (STORAGE_DRIVER=local).
RUN addgroup --system appgroup \
  && adduser --system --ingroup appgroup appuser \
  && mkdir -p /app/uploads \
  && chown -R appuser:appgroup /app/uploads
USER appuser
EXPOSE 3333
CMD ["node", "dist/server.js"]
