# ConnectAI Backend

API REST para a plataforma ConnectAI, construída com Fastify, Prisma e PostgreSQL.

## Repositório

```
git@github.com:ConnectAI-Labs/connectai-backend.git
```

Antes de fazer push, verifique que o remote aponta para o repositório da organização:

```bash
git remote set-url origin git@github.com:ConnectAI-Labs/connectai-backend.git
git remote -v  # confirmar
```

## Stack

- **Runtime:** Node.js
- **Framework:** Fastify com Zod type provider
- **Banco de dados:** PostgreSQL via Prisma ORM
- **Autenticação:** JWT com `@fastify/jwt`
- **Validação:** Zod
- **Linter/Formatter:** Biome
- **Package manager:** pnpm

## Início rápido

```bash
# Instalar dependências
pnpm install

# Configurar variáveis de ambiente
cp .env.example .env  # ajuste DATABASE_URL e JWT_SECRET

# Aplicar migrations
pnpm db:migrate

# Subir em modo desenvolvimento
pnpm dev
```

A API estará disponível em `http://localhost:3333`.  
Documentação Swagger: `http://localhost:3333/docs`

## Testes

Os testes rodam contra um banco PostgreSQL real (`conectai_test`) — sem mocks.

```bash
# Criar banco de teste (uma vez)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/conectai_test" npx prisma migrate deploy

# Rodar testes
pnpm test

# Modo watch (TDD)
pnpm test:watch
```

O arquivo `.env.test` deve conter:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/conectai_test"
JWT_SECRET="conectai_secret_test"
NODE_ENV=test
```

## Scripts

| Comando | Descrição |
|---|---|
| `pnpm dev` | Servidor em modo watch |
| `pnpm build` | Compila TypeScript |
| `pnpm test` | Roda todos os testes |
| `pnpm check` | Lint + format (Biome) |
| `pnpm db:migrate` | Aplica migrations pendentes |
| `pnpm db:studio` | Abre Prisma Studio |
| `pnpm db:seed` | Popula banco de dev com dados fictícios |

## Colaboração

Veja o [CLAUDE.md](CLAUDE.md) para guia completo de padrões de código, estrutura de módulos, commits e abertura de PRs.
