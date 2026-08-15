# Plano de implementação — tudo no R2 (sem Stream)

Decisão tomada sobre o [MIGRACAO_R2.md](MIGRACAO_R2.md): **migrar imagem, áudio
e vídeo para o Cloudflare R2**, com o vídeo na **opção A** (R2 puro — poster
gerado pelo app, duração/dimensões vindas do cliente como o áudio já faz).
Cloudflare Stream descartado. Este documento é o plano executável: etapa por
etapa, arquivo por arquivo.

Status: aprovado — implementação não iniciada.

---

## Estado final (alvo)

- **Dois buckets por ambiente**: um público (avatar, imagens de evento/post —
  URLs eternas persistidas no banco) e um privado (mídia de chat — servida só
  por URL assinada com TTL). No R2 o acesso público é por bucket, não por
  objeto, então a dualidade `upload`/`authenticated` de hoje vira a escolha do
  bucket.
- **`IStorageService` enxuta**: sem `resourceType` (namespace do Cloudinary),
  sem `asThumbnail` (o poster vira um objeto próprio), `signUpload` devolve um
  presigned PUT, `getAsset` vira `HeadObject` + sniff de formato.
- **Nenhuma dependência do SDK do Cloudinary** — removida na última etapa.
- **Vídeo**: o app sobe o MP4 via presigned PUT com key definida pelo servidor,
  gera o poster localmente e o envia ao backend (pipeline sharp normal);
  `bytes` e `format` são verificados server-side (autoritativos),
  `durationMs`/`width`/`height` vêm do cliente (precedente do áudio,
  [chat.schema.ts:39-41](../src/modules/chat/chat.schema.ts#L39-L41)).

---

## Etapa 0 — Pré-requisitos (infra + confirmações com o mobile)

Sem código de produto. Bloqueia as demais.

**Infra (Cloudflare):**

1. Criar os buckets por ambiente (`clubber-public-dev`, `clubber-private-dev`,
   `clubber-public-prod`, `clubber-private-prod` — nomes a definir).
2. Domínio público do bucket público: **subdomínio próprio** em prod (ex.:
   `media.clubber.app`); `r2.dev` serve para dev. (Resolve a decisão em aberto
   do doc de análise.)
3. Token S3 (Access Key ID + Secret) por ambiente, com escopo mínimo nos
   buckets do ambiente.
4. **Regra de CORS no bucket privado** permitindo `PUT` da origem do app —
   sem ela o upload direto de vídeo (etapa 2) falha no preflight.

**Confirmações com o time mobile (bloqueiam o flip das etapas 1 e 2):**

5. O app **não persiste a URL assinada** da mídia de chat como dado durável
   (modo offline, PR #179). O contrato passa a ser: URL efêmera (TTL ~1h),
   refetch da mensagem quando a URL falhar. É o item de maior risco do
   [MIGRACAO_R2.md](MIGRACAO_R2.md#impacto-no-app-mobile).
6. O app não tem allowlist de host que barre o domínio novo (ATS, CSP,
   `react-native-fast-image`).
7. O app consegue **gerar o poster do vídeo localmente** (um frame → JPEG) —
   é o que viabiliza a opção A.

---

## Etapa 1 — Driver R2 para imagem e áudio (~2 dias, sem breaking change)

O vídeo continua no Cloudinary por **delegação interna** dentro do driver novo.
Nenhum contrato HTTP muda; o app não percebe.

### 1.1 Env ([src/lib/env.ts](../src/lib/env.ts))

- `STORAGE_DRIVER`: enum vira `['cloudinary', 'local', 'r2']`
  ([env.ts:83](../src/lib/env.ts#L83)).
- Novo tipo `R2Credentials` e `resolveR2Credentials()` espelhando o padrão
  DEV/PROD de [resolveCloudinaryCredentials](../src/lib/env.ts#L419-L439):
  `R2_ACCOUNT_ID_*`, `R2_ACCESS_KEY_ID_*`, `R2_SECRET_ACCESS_KEY_*`,
  `R2_BUCKET_PUBLIC_*`, `R2_BUCKET_PRIVATE_*`, `R2_PUBLIC_BASE_URL_*`.

### 1.2 Dependências

- `@aws-sdk/client-s3` (PutObject, DeleteObject, HeadObject, GetObject).
- `@aws-sdk/lib-storage` (upload multipart de stream sem materializar —
  substitui o `upload_stream` do Cloudinary para o áudio).
- **Sem `file-type`**: o pacote é ESM-only a partir da v17 e o projeto é
  CommonJS (`"type": "commonjs"`). Como só aceitamos um conjunto pequeno de
  formatos, um sniffer local de ~30 linhas cobre tudo (ver 1.4).

### 1.3 `src/lib/storage/r2-storage.service.ts`

Implementa a `IStorageService` **atual** (sem mudar a interface nesta etapa):

| Método | Implementação |
|---|---|
| `upload` | `PutObject` no bucket escolhido pelo `deliveryType` (`upload` → público, `authenticated` → privado). Key `${folder}/${uuid}${ext}` (extensão do `filename`, como o driver local). **`ContentType` gravado do `mimetype`** — obrigatório, o R2 devolve o que foi gravado. |
| `uploadStream` | Peek dos primeiros bytes do stream → sniff (1.4) → `detectedResourceType`; depois `Upload` do `@aws-sdk/lib-storage` com `ContentType`. `bytes` contado localmente no pipe. |
| `delete` | `DeleteObject` no bucket do `deliveryType`. `resourceType` ignorado (some na etapa 2). Sem o warn de `'not found'` — no S3 API o delete de key inexistente é um 204 idempotente, não há órfão de namespace. |
| `signedUrl` | Presigned GET **SigV4 síncrono** (1.5) contra o bucket privado, TTL 1h. Com `asThumbnail` (poster de vídeo Cloudinary legado): **delega** ao driver Cloudinary interno. |
| `signUpload` / `getAsset` | **Delegam** a uma instância interna de `CloudinaryStorageService` — o fluxo de vídeo fica intocado até a etapa 2. |

### 1.4 `src/lib/storage/content-sniffer.ts`

Substitui o `resource_type: 'auto'` do Cloudinary na validação de conteúdo do
áudio ([uploads.ts:157-169](../src/lib/uploads.ts#L157-L169)):

- Box `ftyp` no offset 4 (família MP4: M4A, MP4, MOV) → `'video'` (mesma
  semântica do Cloudinary: áudio e vídeo são `'video'`).
- Header EBML `0x1A45DFA3` (WebM/MKV) → `'video'`.
- Magic bytes de JPEG/PNG/WebP → `'image'`.
- Qualquer outra coisa → `'raw'` (rejeitado pelo check existente).

O check em [uploads.ts:161](../src/lib/uploads.ts#L161)
(`detectedResourceType !== 'video'`) **não muda** — a garantia é a mesma, feita
localmente. O teste de conteúdo forjado
([chat.test.ts:717](../src/modules/chat/chat.test.ts#L717)) continua valendo.

### 1.5 `src/lib/storage/sigv4.ts`

Presign GET SigV4 com `node:crypto` (~40 linhas): cálculo puro, sem I/O,
preserva o `signedUrl` **síncrono** que
[`shapeAttachments`](../src/modules/chat/chat.service.ts#L125-L136) exige dentro
do `.map()`. Credenciais estáticas do env — é exatamente o caso em que o
`getSignedUrl` async da SDK não se justifica. Cobrir com teste unitário usando
um test vector conhecido (a assinatura é determinística).

### 1.6 Factory e docs

- [storage/index.ts](../src/lib/storage/index.ts): caso `'r2'` no `getStorage()`.
- `.env.example` e a tabela de env vars do [DEPLOY.md](../DEPLOY.md#L100-L102).

### 1.7 Testes e rollout

- O [fake-storage.ts](../src/test/fake-storage.ts) **não muda** nesta etapa (o
  contrato é o mesmo). Testes novos: unitários do sniffer e do SigV4.
- `pnpm test` verde inteiro (critério do projeto).
- Rollout: `STORAGE_DRIVER=r2` primeiro em dev, depois prod. O Cloudinary
  continua servindo os assets antigos (URLs persistidas) e todo o vídeo.
- Rollback trivial: voltar a env var.

---

## Etapa 2 — Vídeo no R2 (~2-3 dias backend + trabalho no app, breaking change coordenado)

Só começa com a etapa 1 estável em produção e o app pronto para o fluxo novo.

### 2.1 Interface ([storage.interface.ts](../src/lib/storage/storage.interface.ts))

- `StorageResourceType` **morre**: sai de `delete`, `signedUrl`,
  `StreamUploadResult.detectedResourceType` vira uma categoria própria
  (`'media-av' | 'image' | 'raw'` ou mantém os literais atuais — decidir na
  implementação; o que importa é que deixa de ser namespace de delete).
- `deliveryType` **fica** (agora significa "qual bucket").
- `signedUrl(key, opts?)` perde `asThumbnail`.
- `UploadSignature` vira `{ uploadUrl: string; key: string; expiresAt: string }`
  — presigned PUT com key definida **pelo servidor**
  (`conversations/<id>/<uuid>.<ext>`), `Content-Type` assinado e TTL curto
  (~15 min).
- `RemoteAsset` vira `{ key: string; bytes: number; format: string }` — o que o
  provider consegue afirmar. `durationMs`/`width`/`height`/`thumbnailUrl` saem
  do contrato do storage (passam a vir do cliente/poster).

### 2.2 Banco ([prisma/schema.prisma](../prisma/schema.prisma#L371))

- `MessageAttachment` ganha `thumbnailKey String?` — o poster agora é um objeto
  próprio no bucket privado, assinado no read como qualquer mídia.
- `thumbnailUrl` fica por ora (legado; backfill na etapa 3, drop na etapa 4).
- **Migration escrita à mão** (`migrate diff` + revisão), nunca `migrate dev` —
  regra do projeto por causa do drift do PostGIS.

### 2.3 Endpoints de vídeo ([chat.routes.ts](../src/modules/chat/chat.routes.ts#L173-L223), [chat.service.ts](../src/modules/chat/chat.service.ts#L602-L690), [chat.schema.ts](../src/modules/chat/chat.schema.ts))

**`POST /conversations/:id/messages/video/signature`**

- Body novo: `{ mimetype: 'video/mp4' | 'video/quicktime' | 'video/webm' }` —
  define a extensão da key e o `Content-Type` assinado no presign.
- Resposta nova: `{ uploadUrl, key, expiresAt }`. Todo o payload
  Cloudinary (`signature`, `timestamp`, `apiKey`, `cloudName`, `folder`,
  `resourceType`, `type`) some.

**`POST /conversations/:id/messages/video`** — vira **multipart**:

- Campos: `key` (devolvida pela signature), `durationMs`, `width`, `height`
  (declarados pelo cliente — cosmético, precedente do áudio) e arquivo
  `poster` **opcional** (JPEG/PNG/WebP).
- Server-side, na ordem:
  1. Pertencimento: `key.startsWith('conversations/<id>/')` — a
     [verificação em dois campos](../src/modules/chat/chat.service.ts#L590-L600)
     (`assetBelongsToConversation`) e o seam `dyn::` morrem, a key é do
     servidor.
  2. `getAsset(key)`: `HeadObject` → `bytes` (autoritativo — cota +
     limite de 50 MB) e `GET Range bytes=0-4095` → magic bytes confirmam
     MP4/MOV/WebM real (`assertVideoFormat`, reusa o sniffer da etapa 1).
  3. Poster (se veio): pipeline sharp de imagem de chat
     ([uploadMessageImage](../src/lib/uploads.ts#L108-L132)) → bucket privado →
     `thumbnailKey`.
  4. Insert com cota no lock, órfãos limpos com `DeleteObject` direto (a
     lógica de compensação existente fica; só perde o `resourceType`).
- [`shapeAttachments`](../src/modules/chat/chat.service.ts#L125-L137): assina
  `thumbnailKey` quando presente (fallback no `thumbnailUrl` legado até a
  etapa 3 backfillar).

### 2.4 Limpeza

- `resourceTypeForKind` ([uploads.ts:21-25](../src/lib/uploads.ts#L21-L25)) e
  todos os usos somem.
- `deleteChatMedia` **fica** (continua fixando o bucket privado), mas perde o
  `resourceType`.
- A delegação interna ao Cloudinary sai do driver R2. O
  `CloudinaryStorageService` e o SDK **ainda não** são removidos — a etapa 3
  precisa da Admin API para listar/copiar os assets.
- Doc OpenAPI das duas rotas reescrita (hoje descreve o fluxo Cloudinary).

### 2.5 Testes ([fake-storage.ts](../src/test/fake-storage.ts), [chat.test.ts](../src/modules/chat/chat.test.ts))

- Fake reescrito para o contrato novo: `signUpload` → `{ uploadUrl, key,
  expiresAt }` determinísticos; `getAsset` mantém os seams por convenção na key
  (`missing`, `badformat`, `toobig`); o seam `dyn::` some junto com a dualidade
  de pastas.
- `chat.test.ts` (~2800 linhas): ajuste mecânico dos fluxos de vídeo + testes
  novos (poster multipart, poster ausente, key de outra conversa, formato reprovado
  pelo sniff). `pnpm test` verde inteiro.

### 2.6 Coordenação com o app

- Release **conjunto**: o app novo gera poster e usa presigned PUT.
- App antigo: quebra **só o envio** de vídeo (a resposta da signature muda de
  shape); recebimento continua, porque as URLs são mintadas server-side.
  Avaliar forçar versão mínima se o produto tiver esse mecanismo.

---

## Etapa 3 — Migração dos assets existentes (~1 dia)

Script idempotente e retomável (`scripts/migrate-cloudinary-to-r2.ts`), com
`--dry-run`, usando a Admin API do Cloudinary para listar e a S3 API para
gravar. O Cloudinary **fica de pé** até a verificação final.

1. **Mídia de chat (bucket privado)** — a mais simples: o banco guarda a `key`
   (publicId), não a URL. Copiar cada asset para o R2 com **key idêntica** ao
   publicId (sem extensão — irrelevante para presigned GET) e `ContentType`
   derivado do `format` persistido. Zero updates no banco para imagem/áudio.
2. **Posters de vídeo legados**: para cada attachment `VIDEO`, baixar o poster
   do Cloudinary (URL assinada `asThumbnail`), gravar no R2 e preencher
   `thumbnailKey`. É o backfill que libera o drop de `thumbnailUrl`.
3. **Assets públicos (avatar, evento, post)** — URL absoluta persistida
   ([schema.prisma:48](../prisma/schema.prisma#L48)): copiar o objeto e
   reescrever a URL para o domínio público do R2. **Só** reescrever URLs que
   contêm `res.cloudinary.com` — `avatarUrl` pode ser do Google
   ([social-auth.service.ts:157](../src/modules/social-auth/social-auth.service.ts#L157)).
4. **Verificação**: `HeadObject` de cada objeto copiado com `bytes` idêntico ao
   de origem; amostragem manual de URLs no app.

---

## Etapa 4 — Descomissionamento (~0,5 dia)

Só após período de observação com tudo servido pelo R2.

- Remover: `cloudinary` do `package.json`,
  [cloudinary-storage.service.ts](../src/lib/storage/cloudinary-storage.service.ts),
  `resolveCloudinaryCredentials` e todas as env vars `CLOUDINARY_*` (incluindo
  `CLOUDINARY_AUTH_TOKEN_KEY`), o caso `'cloudinary'` do enum
  `STORAGE_DRIVER`, e as menções no `.env.example`/DEPLOY.md.
- Migration à mão dropando `MessageAttachment.thumbnailUrl` (o shape da API não
  muda — o campo respondido passa a ser sempre derivado de `thumbnailKey`).
- Marcar como resolvidos os itens de timeout/retry do
  [RELEASE_CHECKLIST.md:94-99](../RELEASE_CHECKLIST.md#L94-L99) (a AWS SDK traz
  ambos).
- Excluir os assets/conta do Cloudinary depois de um período de segurança
  (sugestão: 30 dias com backup de export).

---

## Riscos e pontos de atenção

| Risco | Mitigação |
|---|---|
| App persiste URL assinada (offline) → mídia quebra ao expirar | Confirmação na etapa 0 é **bloqueante**; contrato passa a ser refetch on-fail |
| `ContentType` esquecido no PutObject → `.m4a` não toca, sem erro claro | Gravado no driver desde o dia 1; teste unitário cobre |
| CORS do bucket privado → preflight do PUT direto falha | Item de infra da etapa 0; testar do app real em dev antes da etapa 2 |
| App antigo × shape novo da signature | Quebra restrita ao envio de vídeo; release coordenado / versão mínima |
| `file-type` é ESM-only e o projeto é CJS | Sniffer local próprio (formatos aceitos são poucos e estáveis) |
| Reescrita de `avatarUrl` atingir URL do Google | Filtro por `res.cloudinary.com` no script; dry-run antes |
| Presign síncrono com clock local defasado | TTL 1h dá folga ampla; skew real de servidor é de segundos |

## Estimativa total

~5-6 dias de backend (0: infra, 1: ~2d, 2: ~2-3d, 3: ~1d, 4: ~0,5d) + o
trabalho do app (poster + fluxo PUT), que pode andar em paralelo a partir do
fim da etapa 1. Etapas 1 e 3 (parcial) entregam valor sozinhas; a conta do
Cloudinary só encolhe de verdade ao fim da etapa 3.
