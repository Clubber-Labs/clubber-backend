# ConnectAI Backend — Guia de Colaboração

## Stack

- **Runtime:** Node.js
- **Framework:** Fastify com Zod type provider
- **Banco de dados:** PostgreSQL via Prisma ORM
- **Autenticação:** JWT com `@fastify/jwt`
- **Validação:** Zod
- **Linter/Formatter:** Biome
- **Package manager:** pnpm

---

## Scripts disponíveis

```bash
# Desenvolvimento
pnpm dev          # sobe o servidor em modo watch
pnpm build        # compila TypeScript
pnpm start        # roda o build compilado

# Qualidade de código
pnpm check        # lint + format com auto-fix (Biome)
pnpm lint         # apenas lint
pnpm format       # apenas format

# Banco de dados
pnpm db:migrate   # executa migrations pendentes
pnpm db:studio    # abre o Prisma Studio
pnpm db:generate  # regenera o Prisma Client
pnpm db:seed      # popula o banco de desenvolvimento com dados fictícios

# Testes
pnpm test         # roda todos os testes uma vez
pnpm test:watch   # modo watch — ideal para TDD
pnpm test:coverage # relatório de cobertura
```

---

## Padrão de projeto: Repository Pattern + Service Layer

Todo módulo segue obrigatoriamente esta estrutura:

```
src/modules/<nome>/
├── <nome>.schema.ts      → schemas Zod e tipos inferidos
├── <nome>.repository.ts  → queries no Prisma (única camada com DB)
├── <nome>.service.ts     → lógica de negócio
├── <nome>.controller.ts  → handlers HTTP
└── <nome>.routes.ts      → definição de rotas
```

### Responsabilidade de cada camada

| Camada | Faz | Nunca faz |
|---|---|---|
| `schema` | Define schemas Zod e exporta tipos | Lógica ou acesso ao banco |
| `repository` | Queries com Prisma | Regras de negócio, HTTP |
| `service` | Regras de negócio, validações | Acesso direto ao Prisma, HTTP |
| `controller` | Recebe request, chama service, responde | Lógica de negócio, Prisma |
| `routes` | Registra rotas com schemas de validação | Qualquer lógica |

### Fluxo de uma requisição

```
HTTP Request → routes → controller → service → repository → banco
HTTP Response ←       ←            ←         ←
```

---

## Exemplo: como criar um novo módulo

Seguindo o módulo `auth` como referência:

### 1. schema.ts
```ts
import { z } from 'zod'

export const createEventSchema = z.object({
  title: z.string().min(3),
  date: z.string().datetime(),
})

export type CreateEventBody = z.infer<typeof createEventSchema>
```

### 2. repository.ts
```ts
import { prisma } from '../../lib/prisma'
import type { CreateEventBody } from './events.schema'

export async function findAllEvents() {
  return prisma.event.findMany()
}

export async function createEvent(data: CreateEventBody & { authorId: string }) {
  return prisma.event.create({ data })
}
```

### 3. service.ts
```ts
import { createEvent, findAllEvents } from './events.repository'
import type { CreateEventBody } from './events.schema'

export async function listEvents() {
  return findAllEvents()
}

export async function addEvent(data: CreateEventBody, authorId: string) {
  return createEvent({ ...data, authorId })
}
```

### 4. controller.ts
```ts
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { CreateEventBody } from './events.schema'
import { addEvent, listEvents } from './events.service'

export async function getEvents(_request: FastifyRequest, reply: FastifyReply) {
  const events = await listEvents()
  return reply.send(events)
}

export async function postEvent(
  request: FastifyRequest<{ Body: CreateEventBody }>,
  reply: FastifyReply,
) {
  const event = await addEvent(request.body, request.user.sub)
  return reply.status(201).send(event)
}
```

### 5. routes.ts
```ts
import type { FastifyInstance } from 'fastify'
import { getEvents, postEvent } from './events.controller'
import { createEventSchema } from './events.schema'

export async function eventsRoutes(app: FastifyInstance) {
  app.get('/events', getEvents)

  app.post(
    '/events',
    { schema: { body: createEventSchema }, onRequest: [app.authenticate] },
    postEvent,
  )
}
```

### 6. Registrar no server.ts
```ts
import { eventsRoutes } from './modules/events/events.routes'

app.register(eventsRoutes)
```

---

## Regras de código

- **Aspas simples** e **sem ponto e vírgula** (configurado no Biome)
- **Tipos sempre inferidos do Zod** — não criar interfaces/types duplicados
- **Controller nunca acessa Prisma diretamente**
- **Service nunca importa `FastifyRequest` ou `FastifyReply`**
- **Repository nunca tem lógica de negócio**
- Erros no service são lançados como `throw { statusCode, message }` e capturados no controller

---

## Code review do Copilot

Quando o Copilot (ou qualquer revisor automatizado) sugerir uma correção em um PR, **nunca copie e cole o snippet sugerido diretamente**. O fluxo correto é:

1. **Ler a sugestão como um aviso, não como solução** — o Copilot identifica o sintoma, mas a causa raiz e a melhor correção podem ser diferentes do que ele propõe.
2. **Investigar o código por conta própria** — abrir o arquivo apontado, entender o contexto real (tipos envolvidos, callers, side effects, convenções do módulo) e validar se o problema descrito existe mesmo.
3. **Aplicar uma correção autoral** — escrever a solução no estilo do projeto, respeitando as convenções já existentes (nomes, padrões de tipo, organização). A correção pode coincidir com o que o Copilot sugeriu, mas deve ser fruto da investigação, não cópia.
4. **Justificar no commit/PR** — descrever o que foi corrigido e *por que* (causa raiz), não apenas "aplicar sugestão do Copilot".

A razão: sugestões automáticas frequentemente tratam sintomas em isolamento, ignoram convenções locais e podem introduzir inconsistências. Investigar antes de aplicar mantém o código coeso e evita "patches" que desviam do estilo do projeto.

---

## Autenticação

Rotas protegidas usam o hook `authenticate` registrado no `server.ts`:

```ts
app.get('/rota-protegida', { onRequest: [app.authenticate] }, handler)
```

Para rotas que devem funcionar com ou sem token (ex.: ver evento público), use `authenticateOptional`:

```ts
app.get('/events/:id', { onRequest: [app.authenticateOptional] }, handler)
```

O `id` do usuário autenticado é acessado via `request.user.sub` no controller. Para rotas com auth opcional, use `request.user?.sub`.

---

## Padrão RESTful

Todas as rotas devem seguir as convenções REST:

### Nomenclatura de rotas

| Método | Rota | Ação |
|---|---|---|
| `GET` | `/resources` | Listar todos |
| `GET` | `/resources/:id` | Buscar por ID |
| `POST` | `/resources` | Criar |
| `PUT` | `/resources/:id` | Atualizar (substituição completa) |
| `PATCH` | `/resources/:id` | Atualizar (substituição parcial) |
| `DELETE` | `/resources/:id` | Deletar |

Recursos aninhados (sub-recursos) usam hierarquia na URL:

```
GET    /events/:eventId/attendances       → listar presenças do evento
POST   /events/:eventId/attendances       → confirmar presença
DELETE /events/:eventId/attendances       → cancelar presença
```

### Status HTTP

| Situação | Status |
|---|---|
| Leitura bem-sucedida | `200 OK` |
| Criação bem-sucedida | `201 Created` |
| Deleção sem retorno | `204 No Content` |
| Dados inválidos | `400 Bad Request` |
| Não autenticado | `401 Unauthorized` |
| Sem permissão | `403 Forbidden` |
| Recurso não encontrado | `404 Not Found` |
| Conflito (duplicado) | `409 Conflict` |
| Erro interno | `500 Internal Server Error` |

### Tratamento de erros

Erros lançados no service com `throw { statusCode, message }` são capturados pelo error handler global do Fastify registrado no `server.ts`. **Nunca use try/catch nos controllers** — deixe o error handler global tratar.

```ts
// service.ts ✅
throw { statusCode: 404, message: 'Usuário não encontrado' }

// controller.ts ✅ — sem try/catch
export async function getUser(request, reply) {
  const user = await getUserById(request.params.id)
  return reply.send(user)
}
```

---

## Testes

O projeto usa **Vitest** com testes de integração por módulo. Cada teste roda contra um banco PostgreSQL real dedicado (`conectai_test`), sem mocks — garantindo que queries, constraints e regras de negócio sejam testadas de ponta a ponta.

### Configuração inicial (uma vez por ambiente)

**1. Criar o banco de teste:**

O Prisma cria o banco automaticamente ao rodar as migrations:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/conectai_test" npx prisma migrate deploy
```

**2. Criar o arquivo `.env.test`** na raiz do projeto (já existe no repositório):

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/conectai_test"
JWT_SECRET="conectai_secret_test"
NODE_ENV=test
```

> O banco de teste é completamente separado do banco de desenvolvimento. Nunca use `conectai_dev` aqui.

---

### Como rodar os testes

```bash
pnpm test           # roda todos os testes uma vez (CI)
pnpm test:watch     # modo watch — fica observando mudanças (TDD)
pnpm test:coverage  # roda e gera relatório de cobertura em /coverage
```

---

### Estrutura dos testes

```
src/
├── test/
│   ├── app.ts          → instância do Fastify configurada para testes
│   ├── factories.ts    → funções para criar dados no banco (makeUser, makeEvent, etc.)
│   ├── prisma.ts       → cliente Prisma apontando para o banco de teste
│   ├── setup.ts        → limpa todas as tabelas após cada teste (afterEach)
│   └── global-setup.ts → carrega o .env.test antes de qualquer import
└── modules/
    └── <módulo>/
        └── <módulo>.test.ts  → testes do módulo
```

---

### Padrão de escrita de testes (TDD)

Seguimos o modelo **Red → Green → Refactor**:

1. Escreva o teste descrevendo o comportamento esperado — ele vai falhar
2. Implemente o código mínimo para o teste passar
3. Refatore mantendo todos os testes verdes

**Estrutura de um arquivo de teste:**

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../test/app'
import { makeUser, makeEvent } from '../../test/factories'
import { testPrisma } from '../../test/prisma'

let app: FastifyInstance

function token(app: FastifyInstance, userId: string) {
  return app.jwt.sign({ sub: userId })
}

beforeAll(async () => {
  app = buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await testPrisma.$disconnect()
})

describe('POST /events', () => {
  it('cria evento autenticado', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'POST',
      url: '/events',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { title: 'Festa', /* ... */ },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ authorId: user.id })
  })

  it('retorna 401 sem autenticação', async () => {
    const res = await app.inject({ method: 'POST', url: '/events', body: {} })
    expect(res.statusCode).toBe(401)
  })
})
```

**Regras:**
- Um arquivo de teste por módulo: `<módulo>.test.ts` dentro da pasta do módulo
- Use `makeUser()`, `makeEvent()` etc. das factories — nunca insira dados manualmente com SQL
- Teste sempre os cenários de **sucesso** e os de **erro** (401, 403, 404, 409)
- O `afterEach` no `setup.ts` limpa o banco automaticamente — não se preocupe com limpeza manual
- Não use mocks do Prisma — teste contra o banco real

---

### Factories disponíveis

| Função | O que cria |
|---|---|
| `makeUser(overrides?)` | Usuário com senha `senha123` |
| `makeEvent(authorId, overrides?)` | Evento público ou privado |
| `makeFollow(followerId, followingId, status?)` | Relacionamento de follow |
| `makeAttendance(userId, eventId, type?)` | Presença em evento |
| `makeInvite(eventId, inviterId, invitedId)` | Convite para evento privado |

---

## Banco de dados

Variáveis de ambiente no `.env`:

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/conectai_dev"
JWT_SECRET="conectai_secret_dev"
PORT=3333
NODE_ENV=development
```

Após alterar o `prisma/schema.prisma`, rode:

```bash
pnpm db:migrate   # cria e aplica a migration
pnpm db:generate  # regenera o Prisma Client
```

---

## Documentação da API

Com o servidor rodando, acesse:

```
http://localhost:3333/docs
```

---

## Branches e Pull Requests

### Nomenclatura de branches

Colaboradores devem sempre criar branches a partir da `main` seguindo o padrão:

```
<tipo>/<descricao-curta>
```

| Tipo | Quando usar |
|---|---|
| `feat/` | Nova funcionalidade |
| `fix/` | Correção de bug |
| `refactor/` | Refatoração sem mudança de comportamento |
| `chore/` | Configuração, dependências, scripts |
| `docs/` | Documentação |

**Exemplos:**
```
feat/auth-login
fix/token-expiration
refactor/events-service
chore/update-dependencies
```

### Regras de branch

- **Nunca commitar diretamente na `main`**
- Sempre criar uma branch a partir da `main` atualizada
- Uma branch deve ter **um único objetivo** — não misturar features e fixes
- Deletar a branch após o merge do PR

### Repositório remoto

O repositório oficial do projeto é:

```
git@github.com:ConnectAI-Labs/connectai-backend.git
```

Configure o remote corretamente antes de fazer push:

```bash
git remote set-url origin git@github.com:ConnectAI-Labs/connectai-backend.git
```

### Fluxo de trabalho

```
1. git checkout main && git pull
2. git checkout -b feat/nome-da-feature
3. Desenvolver e commitar
4. git push origin feat/nome-da-feature
5. Abrir PR no GitHub (ConnectAI-Labs/connectai-backend)
6. Aguardar code review e aprovação
7. Merge feito pelo owner do repositório
```

### Commits

Seguir o padrão **Conventional Commits** em **português**, no imperativo:

```
<tipo>: <descrição curta no imperativo>
```

Tipos válidos: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `style`

**Exemplos:**
```
feat: adicionar autenticação JWT no endpoint de login
fix: retornar 401 quando senha não corresponde
refactor: mover queries do Prisma para a camada repository
chore: adicionar script de lint no biome
```

Se necessário, adicione corpo explicando o **porquê** (não o quê):

```
feat: adicionar refresh token na autenticação

O token de acesso expira em 15 minutos. O refresh token permite
renovar a sessão sem o usuário precisar fazer login novamente.
```

### Abrindo um Pull Request

- **Título:** mesmo formato do commit (`feat: ...`) em português, máximo 72 caracteres
- **Descrição** deve ter as seções:
  - `## O que foi feito`
  - `## Por que foi feito`
  - `## Como testar`
- Referenciar a issue relacionada se houver (`Closes #123`)
- O PR só pode ser mergeado após **aprovação do owner**
- Resolver todos os comentários antes do merge

### Regras de proteção da main

- PR obrigatório antes de mergear
- Mínimo de **1 aprovação** (do owner)
- Aprovação invalidada se novos commits forem adicionados após o review
- Somente o owner pode fazer push direto e merge na `main`

---

## Configurando mensagens de commit via IA (Claude Code)

O Claude Code pode gerar mensagens de commit e PRs automaticamente seguindo os padrões deste projeto. Siga o passo a passo abaixo para configurar.

### Pré-requisitos

- Ter o [Claude Code](https://claude.ai/code) instalado (`npm install -g @anthropic-ai/claude-code`)
- Estar autenticado (`claude auth`)

### Passo 1 — Abrir o arquivo de configuração global

O arquivo fica em `~/.claude/settings.json`. Abra no terminal:

```bash
open ~/.claude/settings.json
```

Ou edite diretamente pelo Claude Code:

```bash
claude settings
```

### Passo 2 — Adicionar o prompt de instruções

Cole o seguinte conteúdo no `settings.json`:

```json
{
  "systemPrompt": "Ao gerar mensagens de commit, siga rigorosamente o padrão Conventional Commits: use o formato `<tipo>: <descrição curta no imperativo>` em português. Tipos válidos: feat, fix, refactor, chore, docs, test, style. Mantenha o assunto com menos de 72 caracteres. Se necessário, adicione uma linha em branco seguida de um corpo explicando O PORQUÊ (não o quê). Exemplos: `feat: adicionar autenticação JWT no endpoint de login`, `fix: retornar 401 quando senha não corresponde`. Nunca use mensagens vagas como 'atualizar código' ou 'corrigir bug'.\n\nAo gerar títulos e descrições de Pull Request, siga esta estrutura:\n- Título: mesmo formato do commit (`feat: ...`) em português\n- Seções do corpo: ## O que foi feito, ## Por que foi feito, ## Como testar\n- Mantenha o título com menos de 72 caracteres\n- Referencie issues relacionadas quando aplicável (`Closes #123`)\n- Seja objetivo e claro para que o revisor entenda a mudança sem precisar ler todo o código."
}
```

### Passo 3 — Usar no dia a dia

Com o Claude Code aberto no projeto, após fazer suas alterações basta pedir:

```
faça o commit das minhas alterações
```

```
abra um PR com as minhas alterações
```

O Claude vai analisar o diff, gerar a mensagem seguindo os padrões deste projeto e executar o commit ou criar o PR automaticamente.

### Passo 4 — Verificar se está funcionando

Rode no terminal para confirmar que o Claude Code está ativo:

```bash
claude --version
```

E dentro do projeto:

```bash
claude
```

> As configurações do `settings.json` são globais — valem para todos os projetos onde você usar o Claude Code.
