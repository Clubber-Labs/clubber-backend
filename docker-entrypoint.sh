#!/bin/sh
set -e

# pnpm não existe no runtime (só o estágio build roda `corepack enable`), então
# chama o binário do prisma direto de node_modules — ele é dependency, não devDep.
./node_modules/.bin/prisma migrate deploy

# exec "$@" substitui o processo do shell pelo comando do CMD: SIGTERM cai
# direto nele (ex.: node dist/server.js) e o graceful shutdown do server.ts
# roda. Sem exec, o sinal morre no shell.
exec "$@"
