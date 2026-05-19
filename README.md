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

## Billing (Stripe)

O módulo `billing` integra com Stripe via Checkout Sessions e webhooks. Em
desenvolvimento, use o Stripe CLI (`stripe listen --forward-to localhost:3333/webhooks/stripe`)
para encaminhar eventos do test mode.

### Deploy do webhook em produção

A URL `https://api.connectai.../webhooks/stripe` precisa ser registrada
manualmente no Dashboard do Stripe (uma vez por ambiente — staging e prod
têm secrets diferentes):

1. **Stripe Dashboard → Developers → Webhooks → Add endpoint**
2. URL: `https://<dominio>/webhooks/stripe`
3. Selecionar os eventos que o handler trata:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
   - `setup_intent.succeeded`
4. Após criar, copiar o **Signing secret** (`whsec_...`) e setar como
   `STRIPE_WEBHOOK_SECRET` no ambiente.

### Variáveis de ambiente

| Variável | Onde obter |
|---|---|
| `STRIPE_SECRET_KEY` | Dashboard → Developers → API keys (`sk_live_...` em prod, `sk_test_...` em dev) |
| `STRIPE_WEBHOOK_SECRET` | Endpoint criado no passo acima (prod) ou saída do `stripe listen` (dev) |
| `STRIPE_PREMIUM_PRICE_ID` | Dashboard → Products → preço recorrente do plano Premium (`price_...`) |
| `STRIPE_CHECKOUT_SUCCESS_URL` | URL do frontend pós-pagamento (ex.: `https://app.connectai.../billing/success`) |
| `STRIPE_CHECKOUT_CANCEL_URL` | URL do frontend após cancelar (ex.: `https://app.connectai.../billing/canceled`) |
| `STRIPE_CHECKOUT_ALLOWED_REDIRECT_HOSTS` | Hosts permitidos pros overrides `successUrl`/`cancelUrl` da request, separados por vírgula (defesa anti-open-redirect) |

### Rotacionando secrets

- **API key comprometida:** Dashboard → API keys → Roll → atualizar
  `STRIPE_SECRET_KEY` em todos os ambientes que rodam o backend.
- **Webhook secret:** Dashboard → Webhooks → endpoint → Roll signing secret →
  atualizar `STRIPE_WEBHOOK_SECRET`. Stripe permite os dois secrets ativos
  simultaneamente por algumas horas pra zero-downtime.

## Colaboração

Veja o [CLAUDE.md](CLAUDE.md) para guia completo de padrões de código, estrutura de módulos, commits e abertura de PRs.
