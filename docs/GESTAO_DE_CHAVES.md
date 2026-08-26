# Gestão de chaves e segredos — Clubber Backend

Documento operacional. Complementa a seção 1 do [DEPLOY.md](../DEPLOY.md), que
lista *quais* variáveis existem; aqui está *de onde elas vêm, onde ficam
guardadas e o que fazer quando uma vaza ou se perde*.

Existe por causa de uma assimetria: quase todo segredo do projeto é
descartável — vazou, você regera no painel do provedor e segue. A `CHAT_KEK_V*`
não é. Perdê-la é perda **total e permanente** de todo o conteúdo de chat, e
nenhum processo do projeto tratava isso de forma diferente de uma API key de
terceiro.

---

## 1. Inventário

Três faixas, definidas pelo que acontece quando o segredo **some** (não quando
vaza — vazamento se resolve rotacionando em qualquer uma das faixas).

### 1.1. Irrecuperável — não há plano B

| Segredo | Se perder |
|---|---|
| `CHAT_KEK_V<n>` (a ativa **e** qualquer versão ainda referenciada em `kekVersion`) | Todo o texto de chat, toda a mídia cifrada e toda a prova de denúncia viram ruído permanente |

Três tabelas dependem dela, todas em `prisma/schema.prisma`:
`conversation_keys.wrappedDek` (histórico de texto de todas as conversas),
`message_attachments.dekWrapped` (mídia cifrada) e
`report_evidences.wrappedDek` (snapshot das denúncias).

Não há derivação nem recuperação: a KEK é material bruto de 32 bytes lido do
ambiente. O boot falha sem ela **em todo ambiente**, de propósito — subir e
falhar na primeira escrita seria pior que não subir.

> Uma KEK **inativa** ainda referenciada por alguma linha é tão crítica quanto a
> ativa. O unwrap usa a versão **gravada** no registro, não a ativa
> (`src/lib/crypto/env-key-provider.service.ts`). Remover uma KEK antiga do
> ambiente antes de reembrulhar tudo que aponta para ela tem o mesmo efeito de
> perdê-la — a seção 5 mostra como saber que não sobrou nada apontando para ela.

### 1.2. Recuperável com dano — perda visível ao usuário

| Segredo | Se perder |
|---|---|
| `JWT_SECRET` | Todas as sessões caem **e** todo `mfaSecret` fica indecifrável |

O segundo efeito é o que costuma passar despercebido: a chave que cifra o
segredo de MFA em repouso é derivada do `JWT_SECRET` por HKDF
(`src/lib/mfa.ts`). Trocá-lo não é operação de rotina — obriga todo usuário com
MFA a recadastrar. A rotação versionada (`v1`→`v2` com fallback de leitura)
está descrita em comentário no arquivo e **não está implementada**.

Os códigos de recuperação de MFA são guardados como hash, então não dependem de
chave nenhuma.

### 1.3. Recuperável — regenerar no provedor

`DATABASE_URL`, `REDIS_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`RESEND_API_KEY`, `R2_ACCESS_KEY_ID_PROD`, `R2_SECRET_ACCESS_KEY_PROD`,
`GOOGLE_PLACES_API_KEY`, `ANTHROPIC_API_KEY`, `EXPO_ACCESS_TOKEN`,
`METRICS_TOKEN`, `SENTRY_DSN`.

Fora da aplicação, no GitHub Actions: `COOLIFY_WEBHOOK_URL`, `COOLIFY_TOKEN`,
`CLAUDE_CODE_OAUTH_TOKEN`. Nenhum segredo de aplicação passa pelo CI — o build
não recebe segredo e o deploy só dispara o webhook.

O Stripe tem procedimento próprio de rotação no [README](../README.md) (permite
os dois secrets ativos por algumas horas, então dá para rotacionar sem
downtime).

### 1.4. Superfície morta — remover do schema

Sete variáveis de Cloudinary (`CLOUDINARY_CLOUD_NAME_*`, `CLOUDINARY_API_KEY_*`,
`CLOUDINARY_API_SECRET_*`, `CLOUDINARY_AUTH_TOKEN_KEY`) seguem declaradas em
`src/lib/env.ts`, junto de `resolveCloudinaryCredentials()`, e **nenhuma é lida
em `src/`** desde a migração para o R2. `FACEBOOK_APP_SECRET` aparece no
`.env.test` sem existir no schema.

Segredo que ninguém usa continua sendo segredo para vazar e para custodiar.
Limpar reduz o inventário em ~30%.

---

## 2. Geração

```bash
openssl rand -base64 32     # CHAT_KEK_V<n> — 32 bytes
openssl rand -hex 32        # JWT_SECRET
```

Regras:

- **Uma chave distinta por ambiente.** Reusar a de desenvolvimento em produção
  faz o ambiente mais fraco definir a segurança do mais forte.
- **Nunca por canal de terceiro.** Slack, e-mail, issue e comentário de PR
  guardam histórico fora do seu controle e frequentemente fora do país.
- **Do terminal direto para o cofre.** Numa sessão cujo histórico não persiste,
  ou apague a linha depois (`history -d`). Não passe por arquivo temporário.
- **A KEK do `.env.test` é fixa e commitada de propósito** — é o que faz a CI
  passar sem injetar env extra, e vale só para o banco de teste. Nunca reusar
  fora dali. O gitleaks do CI barra segredo commitado no repositório, mas não
  enxerga o painel do Coolify: contra esse erro só existe disciplina.

---

## 3. Guarda: três cópias, três domínios de falha

| Cópia | Onde | Para quê |
|---|---|---|
| Fonte da verdade | Vaultwarden, item por ambiente, dentro da organização | Onde se consulta e de onde se copia |
| Operacional | Env var no recurso do app no Coolify | É a que o processo lê no boot |
| Break-glass | Offline — papel em cofre ou pendrive cifrado, fora do escritório | Sobrevive à perda simultânea das outras duas |

O ponto das três cópias é que elas **falhem por motivos diferentes**. Duas
cópias no mesmo servidor são uma cópia.

**Condições para o Vaultwarden servir como custódia da KEK:**

1. **Não pode rodar no mesmo servidor/hipervisor do Coolify.** Se o cofre e a
   aplicação caem juntos, o backup deixou de existir no momento em que seria
   necessário.
2. **O `data/` precisa de backup próprio, fora daquela máquina, com restore
   testado.** É SQLite (`db.sqlite3` mais o `rsa_key`); perder o volume perde o
   cofre inteiro. Self-hosted significa que a redundância é sua.
3. **Mais de uma pessoa precisa conseguir abrir** — organização com dois admins
   ou Emergency Access configurado. Chave sem recuperação não pode depender de
   uma única senha mestra na cabeça de uma única pessoa.

Atendidas as três, o modelo de segurança é o do Bitwarden: cofre cifrado no
cliente, servidor nunca vê o conteúdo, histórico por item.

---

## 4. Backup: a dependência que costuma passar batida

**Backup de banco sem a KEK correspondente é backup inútil.** Um dump restaurado
com uma KEK diferente devolve as mensagens como ruído. Sempre que a KEK ativa
mudar, registre a data — um restore precisa saber qual KEK vigorava no momento
do dump, e é por isso que **nenhuma KEK já usada pode ser descartada** enquanto
existir backup do período.

Na direção oposta, e é o que faz o crypto-shredding valer alguma coisa: **a
retenção do backup de `conversation_keys` precisa ser MENOR que a das
mensagens.** Restaurar um snapshot antigo da tabela de chaves ressuscita chaves
destruídas de propósito e desfaz todo shred posterior. Sem essa política, o
mecanismo é teatro.

> Lacuna aberta: o backup do Postgres é delegado ao Coolify, mas não há
> frequência, retenção nem restore testado documentados. O item segue aberto no
> [RELEASE_CHECKLIST.md](../RELEASE_CHECKLIST.md). Enquanto não fechar, trate
> toda migration destrutiva como evento manual de alto risco.

---

## 5. Rotação da KEK

O procedimento, em quatro passos:

1. Gerar a `CHAT_KEK_V<n+1>` e cadastrá-la **mantendo a anterior no ambiente**.
2. `CHAT_KEK_ACTIVE_VERSION=<n+1>` e deploy. Toda DEK nova nasce na versão nova;
   as antigas seguem legíveis, porque o unwrap usa a versão **gravada** em cada
   registro.
3. Deixar o reconciler de rewrap drenar. Ele reembrulha em lote as DEKs que
   ficaram para trás, sem tocar em nenhum ciphertext de mensagem.
4. **Só então** remover a versão antiga do ambiente.

O sinal que autoriza o passo 4 é a métrica `chat_kek_rewrap_pending` em
`/metrics` (protegida por `METRICS_TOKEN`):

```
chat_kek_rewrap_pending{source="conversation_keys",kek_version="1"} 0
chat_kek_rewrap_pending{source="report_evidences",kek_version="1"}  0
```

**Zerado em todas as fontes e `chat_kek_rewrap_total{result="failed"}` parado.**
Enquanto houver pendente, remover a KEK antiga torna aquele material ilegível.
`failed` subindo é exatamente o alarme de que alguém a removeu cedo demais.

Não há teto de versão: as `CHAT_KEK_V<n>` são descobertas no ambiente por
`discoverChatKeks` (`src/lib/crypto/chat-keks.ts`), então a enésima rotação não
exige mudança de código.

> **Anexos ficam de fora por enquanto.** `message_attachments.dekWrapped` tem
> índice por `kekVersion` mas ainda não é escrito por ninguém — a cifra de mídia
> é fase posterior. Quando entrar, é uma entrada a mais na lista de fontes do
> reconciler (`src/server.ts`), não um mecanismo novo.

---

## 6. Incidente: KEK suspeita de vazamento

O que dá para fazer:

| | |
|---|---|
| ✅ | Promover uma versão nova protege tudo que for **escrito daí em diante** |
| ✅ | O rewrap reembrulha o histórico, então a chave vazada deixa de abri-lo |
| ✅ | Remover a versão vazada do ambiente, **depois** de os pendentes zerarem |
| ❌ | Invalidar backups antigos — ver a ressalva abaixo |

Resposta ao incidente: promover a versão nova, acompanhar
`chat_kek_rewrap_pending` até zerar, remover a vazada do ambiente e do cofre.

**A ressalva que não se resolve rotacionando:** todo backup de banco tirado
*antes* do rewrap guarda os envelopes antigos, e a chave vazada continua abrindo
aqueles dumps. Rotação protege o banco vivo, não cópias já feitas. Para um
vazamento confirmado, o ciclo só fecha quando os backups do período anterior
saírem da retenção — mais um motivo para a retenção ser conhecida e curta.

Vale lembrar o que a cifra promete e o que não promete: a KEK vive no ambiente
do servidor, então quem tiver **ao mesmo tempo** o dump do banco e a env lê
tudo. A proteção é contra vazamento **só** do banco. Isto não é E2EE, e não
deve ser comunicado como tal.

---

## 7. Evolução: KMS

`IKeyProvider` (`src/lib/crypto/key-provider.interface.ts`) nasceu com
assinaturas assíncronas exatamente para esta troca: um provider de AWS/GCP KMS
substitui o `EnvKeyProvider` sem refatorar nenhum caller. Com KMS, a KEK nunca
sai do HSM e as seções 2, 3 e 6 deste documento deixam de existir para ela.

Gatilhos que justificariam a migração: exigência de auditoria ou certificação;
mais de um serviço precisando desembrulhar DEK; ou o time crescendo a ponto de
"quem tem acesso ao cofre" deixar de caber numa conversa. Até lá, o custo
(conta na nuvem, latência por chamada, dependência de rede no caminho de
leitura) não se paga.
