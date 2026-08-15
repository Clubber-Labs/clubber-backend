# Migração Cloudinary → Cloudflare R2

Documento de planejamento. Descreve **o que precisa mudar** para trocar o
Cloudinary pelo Cloudflare R2 como storage de mídia, o que **não** pode ser
migrado como está, e em que ordem fazer.

Status: decidido — migrar **tudo** para o R2, vídeo na opção A (sem Stream).
Plano executável em [PLANO_IMPLEMENTACAO_R2.md](PLANO_IMPLEMENTACAO_R2.md).

---

## Resumo executivo

A arquitetura já está preparada: o storage vive atrás de
[`IStorageService`](../src/lib/storage/storage.interface.ts), é escolhido por env
var em [`getStorage()`](../src/lib/storage/index.ts) e já tem um segundo driver
([`LocalStorageService`](../src/lib/storage/local-storage.service.ts)) mais um fake
de teste. **Só 8 call sites** de produção tocam o storage.

O custo da migração **não está** em escrever o driver novo. Está em três coisas
que o Cloudinary entrega de graça e o R2 — object storage puro, API S3 — não faz:

1. **Detecção do tipo real do conteúdo** (`resource_type: 'auto'`)
2. **Metadados de vídeo** (duração, dimensões, formato real)
3. **Geração de poster/thumbnail** a partir de um frame

Daí a recomendação central: **migrar imagem e áudio para o R2 e manter o vídeo
no Cloudinary numa primeira fase.** O driver é escolhido por env var, então os
dois providers coexistem sem big bang. Imagem + áudio saem em ~2 dias; o vídeo é
um projeto separado, com duas opções avaliadas mais abaixo (R2 puro ou
Cloudflare Stream — a recomendação é R2 puro).

---

## O que hoje depende do Cloudinary

### Superfície de código

| Arquivo | Papel |
|---|---|
| [storage/cloudinary-storage.service.ts](../src/lib/storage/cloudinary-storage.service.ts) | Único ponto que importa o SDK. Substituído pelo driver novo. |
| [storage/storage.interface.ts](../src/lib/storage/storage.interface.ts) | Contrato. Muda pouco (ver `signedUrl` e `UploadSignature`). |
| [storage/index.ts](../src/lib/storage/index.ts) | Factory. Ganha o caso `'r2'`. |
| [lib/env.ts:410-439](../src/lib/env.ts#L410-L439) | Enum do driver + `resolveCloudinaryCredentials()`. Ganha o par para R2. |
| [lib/uploads.ts](../src/lib/uploads.ts) | 6 dos 8 call sites. Só a validação de conteúdo do áudio muda. |
| [chat.service.ts](../src/modules/chat/chat.service.ts) | 2 call sites (`signUpload`, `getAsset`) — ambos **exclusivos de vídeo**. |
| [test/fake-storage.ts](../src/test/fake-storage.ts) | Simula convenções do Admin API do Cloudinary. |
| [chat.routes.ts:181-212](../src/modules/chat/chat.routes.ts#L181-L212) | Doc OpenAPI do fluxo de vídeo, escrita em termos de Cloudinary. |

### O que **não** depende

Vale registrar porque encolhe muito o escopo:

- **Nenhuma transformação do Cloudinary é usada em imagem.** Avatar e imagens de
  evento/post já passam pelo [sharp local](../src/lib/image-processor/) antes de
  subir — o Cloudinary é só um bucket para elas.
- A única transformação usada é o poster de vídeo (`asThumbnail`).

---

## Método a método

| Método | R2 | Esforço |
|---|---|---|
| `upload` | `PutObject` | Trivial |
| `delete` | `DeleteObject` | **Mais simples que hoje** |
| `uploadStream` | `@aws-sdk/lib-storage` (multipart) | Fácil, exceto `detectedResourceType` |
| `signedUrl` | Presigned GET (SigV4) | Fácil, exceto `asThumbnail` e a assinatura síncrona |
| `signUpload` | Presigned PUT/POST | Muda o contrato com o app |
| `getAsset` | `HeadObject` | **Não cobre o caso de uso** |

### Simplificações que a migração traz de brinde

- **`resourceType` e `deliveryType` deixam de existir.** Toda a complexidade de
  namespaces do Cloudinary some: o `'image' | 'video' | 'raw'`, o
  `'upload' | 'authenticated'`, o helper
  [`deleteChatMedia`](../src/lib/uploads.ts#L191-L197) que existe só para ninguém
  esquecer o `deliveryType`, e o warn de `'not found'` no
  [delete](../src/lib/storage/cloudinary-storage.service.ts#L128-L134) que protege
  contra órfão pago. No R2 uma key é uma key.
- **A dualidade "pasta fixa vs. pasta dinâmica" some.** Some o `asset_folder`
  nos uploads e some a
  [verificação de pertencimento em dois campos](../src/modules/chat/chat.service.ts#L592-L599).
- **Expiração real de URL sem custo extra.** Hoje depende do
  `CLOUDINARY_AUTH_TOKEN_KEY` (recurso pago); no R2 é nativo do SigV4.
- **Timeout e retry saem de graça.** Resolve dois itens do
  [RELEASE_CHECKLIST.md:94-99](../RELEASE_CHECKLIST.md#L94-L99) — a AWS SDK traz
  ambos configuráveis.

---

## Os quatro problemas reais

### 1. `detectedResourceType` — validação de áudio por conteúdo

[uploads.ts:157-169](../src/lib/uploads.ts#L157-L169) rejeita áudio cujo **conteúdo
real** não bate com o mimetype declarado pelo cliente, confiando no
`resource_type: 'auto'` do Cloudinary. O R2 aceita qualquer byte sem opinar.

**Solução:** sniffar magic bytes do início do stream (`file-type`) antes de
mandar pro multipart. É a mesma garantia, feita localmente.

**Não aceitar como solução:** confiar no `Content-Type` do cliente. A regra
existe justamente porque ele não é confiável — o teste que cobre isso está em
[chat.test.ts:717](../src/modules/chat/chat.test.ts#L717).

### 2. `signedUrl` é síncrono; o `getSignedUrl` da AWS SDK é async

[`shapeAttachments`](../src/modules/chat/chat.service.ts#L125-L136) assina URLs
dentro de um `.map()` síncrono.

**Solução preferida:** implementar o presign SigV4 com `node:crypto`. É cálculo
puro e determinístico, sem I/O — a SDK só o expõe como async por causa da cadeia
de resolução de credenciais, que aqui é estática. ~40 linhas, preserva a
interface.

**Alternativa:** tornar `shapeAttachments` async — contagia `shapeMessage` e os
callers acima. Mais invasivo por nenhum ganho.

### 3. `asThumbnail` — poster do vídeo

Hoje o Cloudinary gera o JPEG on-demand a partir de um frame
([signedUrl](../src/lib/storage/cloudinary-storage.service.ts#L158-L179)). O R2 não
gera nada. E o vídeo **sobe direto do cliente**, sem passar pelo backend — não
há nem buffer para rodar ffmpeg.

### 4. `getAsset` — a fonte da verdade do vídeo

[chat.service.ts:633-656](../src/modules/chat/chat.service.ts#L633-L656) valida o
vídeo contra o provider — formato, tamanho, duração, dimensões —
**explicitamente não confiando no cliente**. `HeadObject` devolve só bytes e o
content-type declarado.

> **3 e 4 são o mesmo problema.** Por isso o vídeo fica fora da fase 1,
> independente da opção escolhida abaixo.

---

## Vídeo: duas opções

### Quanto cada campo do `getAsset` realmente vale

Antes de escolher, separar o que é **exigência de segurança** do que é
**cosmético**. O "não confia no cliente" de
[chat.service.ts:618](../src/modules/chat/chat.service.ts#L618) não protege os seis
campos igualmente:

| Campo | Para que serve | Precisa vir do provider? |
|---|---|---|
| `bytes` | Cota (`CHAT_USER_STORAGE_QUOTA_BYTES`) e limite de 50 MB | **Sim** — `HeadObject` resolve |
| `format` | `assertVideoFormat` (MP4/MOV/WebM) | **Sim** — magic bytes via Range GET resolvem |
| `durationMs` | UI do player | Não — cosmético |
| `width`, `height` | Aspect-ratio (evitar layout shift) | Não — cosmético |
| `thumbnailUrl` | Preview | Não decidível server-side sem decodificar |

Cota e validação de formato — as duas com peso de segurança — o R2 entrega
barato. Duração e dimensões erradas degradam layout, não abrem brecha.

**Precedente do próprio projeto:** o áudio **já aceita duração vinda do
cliente** — `durationMs` chega como campo de texto do multipart
([chat.schema.ts:39-41](../src/modules/chat/chat.schema.ts#L39-L41)). Se é
aceitável para áudio, é aceitável para vídeo pelo padrão que já vigora aqui.

### Opção A — R2 puro (recomendada)

1. Presigned PUT com a key definida **pelo servidor**
2. `HeadObject` → `bytes` (cota e limite de 50 MB, autoritativo)
3. Range GET dos primeiros KB → magic bytes confirmam MP4/MOV/WebM
4. `durationMs`/`width`/`height` **vêm do cliente**, como já ocorre no áudio
5. **Poster gerado e enviado pelo app** como imagem separada, passando pelo
   mesmo pipeline de sharp de qualquer imagem de chat

O ponto 5 é o que viabiliza a opção: o app tem o vídeo local, gerar um frame é
trivial nele. O poster não é mais perigoso que um `uploadMessageImage` qualquer
— o pior caso é um preview que não corresponde ao vídeo, o que é cosmético.

O esforço se desloca do backend para o app (gerar e subir o poster).

### Opção B — Cloudflare Stream

Provider de vídeo dedicado: upload direto assinado, poster, duração, dimensões,
transcode, HLS e URLs assinadas prontos. Entra como driver próprio ou como um
`IVideoService` separado; o R2 fica com imagem e áudio.

### Comparação

| | A — R2 puro | B — Stream |
|---|---|---|
| Peças novas | Nenhuma | Provider + contrato |
| Trabalho no app | Gerar e subir o poster | Só trocar o payload do `signUpload` |
| Duração/dimensões | Do cliente (como o áudio já faz) | Autoritativos |
| Transcode / HLS | Não tem | Tem |
| Custo | Storage barato, egress zero | Por minuto armazenado/assistido |

### Recomendação: opção A

Para vídeo curto de chat não há necessidade de transcode nem de qualidade
adaptativa, e o "não confia no cliente" continua valendo exatamente onde importa
(cota e formato). Um provider só e custo menor.

A **opção B** passa a valer se aparecer vídeo longo, streaming adaptativo ou
requisito de reprodução em rede ruim.

### Alternativa descartada (vale para as duas opções)

ffprobe no backend, baixando o MP4 de até 50 MB do R2 após o upload. Obriga a um
binário nativo no deploy, um job assíncrono, e abre uma janela em que a mensagem
existe sem metadados — tudo isso para obter dois campos cosméticos.

---

## Impacto no app (mobile)

### Fase 1 (imagem + áudio): nenhuma mudança de contrato

Imagem e áudio sobem por multipart **para o backend**, que devolve as URLs.
Nenhum endpoint, campo ou shape de resposta muda. O `signUpload`/`publicId` — a
única parte que expõe detalhe do Cloudinary ao cliente — é exclusivo do vídeo.

Três verificações comportamentais, mesmo assim:

1. **Domínio das URLs muda** (`res.cloudinary.com` → domínio do R2). Quebra se o
   app tiver allowlist de host (`next/image`, `react-native-fast-image`, CSP,
   ATS no iOS) ou se montar URL de transformação no cliente. Indício de que o
   primeiro já está resolvido: [social-auth.service.ts:157](../src/modules/social-auth/social-auth.service.ts#L157)
   grava `avatarUrl` vindo direto do Google, então o app já renderiza host
   arbitrário.

2. **TTL das URLs assinadas — o item de maior risco.** Hoje, sem
   `CLOUDINARY_AUTH_TOKEN_KEY`, o `signedUrl` devolve URL **eterna**. Presigned
   URL SigV4 tem **máximo de 7 dias**, e na prática se usaria ~1h. Como o chat
   tem modo offline (PR #179), **se o app persiste a URL da mídia e a reusa, a
   mídia quebra ao expirar.** O modelo correto: a URL é efêmera e mintada a cada
   leitura (o backend já faz isso) — o app deve refetchar a mensagem quando a URL
   falhar, nunca tratar a URL como parte durável do dado. **Verificar antes de
   migrar.**

3. **`Content-Type` precisa ser gravado no `PutObject`.** O Cloudinary infere; o
   R2 devolve o que foi gravado. Um `.m4a` salvo como
   `application/octet-stream` pode simplesmente não tocar no app, sem erro claro.
   Uma linha no driver, chata de debugar se esquecida.

### Fase 2 (vídeo): mudança coordenada

O payload de `signUpload`
(`{ signature, timestamp, apiKey, cloudName, folder, resourceType, type }`) é
100% Cloudinary e vai direto pro cliente. Vira uma URL assinada única.
**Breaking change cross-repo, exige release coordenado com o mobile.**

Efeito colateral bom: com a key definida no servidor, a verificação de
pertencimento de pasta some, e o limite de 50 MB passa a ser imponível na borda
(policy de upload) em vez de checado depois do arquivo já ter subido.

---

## Migração dos assets existentes

- **`avatarUrl` e imagens de evento/post**: URL absoluta persistida no banco
  ([schema.prisma:48](../prisma/schema.prisma#L48)). Precisa copiar os objetos para
  o R2 **e** reescrever as URLs, ou manter leitura dupla por um período. Copiar
  primeiro, reescrever depois, manter o Cloudinary de pé até a confirmação.
- **Mídia de chat**: sofre menos — o banco guarda a `key`, não a URL; a
  assinatura acontece no read.
- **Atenção**: `avatarUrl` também pode conter URL do Google (login social) — o
  script de reescrita **não pode** assumir que todo valor é do Cloudinary.

---

## Plano de execução

### Fase 1 — R2 para imagem e áudio (~2 dias)

1. Adicionar `'r2'` ao enum `STORAGE_DRIVER` ([env.ts:83](../src/lib/env.ts#L83)) e
   um `resolveR2Credentials()` espelhando o padrão DEV/PROD do
   [resolveCloudinaryCredentials](../src/lib/env.ts#L419-L439).
2. Criar `src/lib/storage/r2-storage.service.ts` implementando `IStorageService`.
   `signUpload`/`getAsset` **delegam ao driver do Cloudinary** (vídeo intocado).
3. Presign SigV4 síncrono com `node:crypto`.
4. Sniff de conteúdo por magic bytes no `uploadStream`.
5. Gravar `ContentType` correto no `PutObject`.
6. Atualizar `.env.example` e a tabela de env vars do
   [DEPLOY.md:100-102](../DEPLOY.md#L100-L102).

### Fase 2 — Testes (~1 dia)

O [fake-storage.ts](../src/test/fake-storage.ts) codifica convenções do Admin API
do Cloudinary nos `publicId` (`missing`, `badformat`, `toobig`, `dyn::`). Ajuste
mecânico, mas [chat.test.ts](../src/modules/chat/chat.test.ts) tem ~2800 linhas.
Critério de conclusão do projeto vale aqui: `pnpm test` verde inteiro.

### Fase 3 — Migração dos assets (~1 dia)

Copiar objetos, reescrever URLs no banco, manter o Cloudinary de pé até
confirmar. Ver ressalva do `avatarUrl` do Google acima.

### Fase 4 — Vídeo (~2 dias na opção A, ~2-4 dias na opção B)

Só depois de 1-3 estabilizadas, e com release do app coordenado. Na opção A
parte do esforço é do lado do app (gerar o poster), não do backend.

**Total: ~1 semana**, ou ~1 semana e meia se a opção B for escolhida. Fases 1-3
entregam valor sozinhas e não bloqueiam nada.

---

## Decisões em aberto

- [x] Vídeo: **opção A (R2 puro)** — decidido; ver o
      [plano de implementação](PLANO_IMPLEMENTACAO_R2.md).
- [ ] Opção A depende do app conseguir gerar o poster localmente — confirmar
      na etapa 0 do plano.
- [ ] TTL das URLs assinadas de chat — depende de confirmar o comportamento de
      cache do app (etapa 0 do plano).
- [x] Domínio público do R2: **subdomínio próprio** em prod, `r2.dev` em dev.
- [ ] Imagens: precisamos de transformação server-side no futuro (Cloudflare
      Images), ou o sharp no upload continua suficiente?
