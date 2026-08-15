# Mídia no R2 — o que muda para o app

O backend migrou o storage de mídia do Cloudinary para o Cloudflare R2
(branch `feat/storage-r2`). Este doc é para o time do app: o que muda, o que
não muda, e o que o app precisa implementar antes do release conjunto.

**TL;DR:**

- **Imagem e áudio: nenhuma mudança de contrato.** Mesmos endpoints, mesmos
  shapes.
- **URLs de mídia de chat agora expiram (1 h).** Antes eram eternas. O app não
  pode persistir a URL — refetch da mensagem quando a mídia falhar.
- **Vídeo: fluxo novo, breaking.** Presigned PUT + poster gerado pelo app.
  Release coordenado com o backend.

---

## O que NÃO muda

- Upload de imagem de chat, áudio de chat, avatar, imagem de evento/post:
  multipart para o backend, como hoje.
- Shape dos attachments nas mensagens: `kind`, `url`, `thumbnailUrl`,
  `format`, `size`, `durationMs`, `width`, `height`, `waveform`, `order`.
- `Idempotency-Key` (header) em todos os envios de mídia.

## Mudanças que valem para TODAS as mídias

### 1. Os domínios das URLs mudam

| Mídia | Antes | Agora |
|---|---|---|
| Pública (avatar, evento, post) | `res.cloudinary.com` | `pub-<hash>.r2.dev` (dev) / domínio próprio (prod, a definir: `media.clubber.app`) |
| Chat (imagem, áudio, vídeo, poster) | `res.cloudinary.com` | `<account>.r2.cloudflarestorage.com` (URL assinada) |

**Ação no app:** conferir se existe allowlist de host — ATS (iOS), CSP,
config do `react-native-fast-image` ou similar — e liberar os domínios novos.

### 2. URLs de mídia de chat expiram — item mais crítico

Antes: a URL assinada do Cloudinary era **eterna**. Agora: **expira em 1 hora**.

O modelo correto (que o backend já pratica): a URL é **efêmera e re-gerada a
cada leitura** da mensagem. O que é durável é a mensagem, não a URL.

**Ação no app (bloqueante para o modo offline):**

- Nunca persistir `url`/`thumbnailUrl` como dado durável no cache offline.
- Quando o download/render de uma mídia falhar com `403`, refetchar a
  mensagem (`GET` da conversa/mensagem) para obter URL nova.
- Cachear o **binário** baixado é ok e recomendado — o que não pode é reusar
  a URL velha.

---

## Vídeo — fluxo novo (breaking)

O payload do Cloudinary (`signature`, `timestamp`, `apiKey`, `cloudName`,
`folder`, `resourceType`, `type`) **deixa de existir**. O fluxo continua em 3
passos, mas cada passo muda:

### Passo 1 — pedir a assinatura

```
POST /conversations/:id/messages/video/signature
Content-Type: application/json

{ "mimetype": "video/mp4" }   // ou "video/quicktime" | "video/webm"
```

Resposta `200`:

```json
{
  "uploadUrl": "https://<account>.r2.cloudflarestorage.com/…?X-Amz-…",
  "key": "conversations/<id>/<uuid>.mp4",
  "expiresAt": "2026-08-15T18:30:00.000Z"
}
```

- `uploadUrl` vale **15 minutos**. Expirou → recomeça do passo 1.
- `key` é definida **pelo servidor** — guarde para o passo 3.

### Passo 2 — subir o vídeo (PUT cru, não multipart)

```
PUT <uploadUrl>
Content-Type: video/mp4        ← EXATAMENTE o mimetype do passo 1

<bytes do arquivo no corpo>
```

- **Não** é multipart/form-data — o corpo é o binário puro.
- O `Content-Type` é **assinado** na URL: enviar outro valor (ou omitir) →
  `403` do R2.
- Resposta `200` sem corpo relevante. Não há mais `public_id` — o app já tem
  a `key`.

### Passo 3 — confirmar e criar a mensagem

```
POST /conversations/:id/messages/video
Content-Type: multipart/form-data
Idempotency-Key: <a mesma do fluxo, se houver retry>

campos de texto:
  key        = "conversations/<id>/<uuid>.mp4"   (obrigatório, do passo 1)
  durationMs = "8200"        (opcional)
  width      = "1080"        (opcional)
  height     = "1920"        (opcional)
arquivo:
  poster     = frame do vídeo em JPEG/PNG/WebP   (opcional, ≤ 5 MB)
```

Resposta `201`: a mensagem, com `attachments[0].kind = "VIDEO"` no shape de
sempre.

**Retry:** reuse a **mesma** `key` e a mesma `Idempotency-Key` — não peça
assinatura nova para retry do passo 3.

### Novas responsabilidades do app

1. **Gerar o poster localmente** (1 frame → JPEG) e enviá-lo no passo 3.
   Sem poster, a mensagem fica **sem preview** (`thumbnailUrl: null`).
2. **Declarar `durationMs`/`width`/`height`** — o backend não extrai mais
   esses metadados do provider (mesmo modelo que o áudio já usa). Servem para
   a UI do player e para reservar aspect-ratio; se ausentes, ficam `null`.

O que continua sendo validado **no backend** (não precisa e não adianta
burlar): existência do objeto, formato real por magic bytes (MP4/MOV/WebM),
tamanho ≤ 50 MB, cota de storage do usuário e pertencimento da `key` à
conversa.

### Erros por passo

| Passo | Status | Causa |
|---|---|---|
| 1 | `400` | `mimetype` ausente/inválido |
| 1 | `401` / `403` / `404` | sem auth / não participa ou bloqueado / conversa inexistente |
| 1 | `501` | backend com storage local (dev sem R2) |
| 2 | `403` | URL expirada (>15 min) ou `Content-Type` diferente do assinado |
| 3 | `400` | `key` não encontrada no storage · conteúdo real não é MP4/MOV/WebM · metadados inválidos |
| 3 | `403` | `key` de outra conversa · não participa · bloqueado |
| 3 | `413` | vídeo > 50 MB · cota de storage excedida · poster > 5 MB |

---

## Compatibilidade e rollout

- **App antigo × backend novo:** quebra **só o envio** de vídeo (o shape da
  assinatura muda). Recebimento de tudo — inclusive vídeos antigos — continua
  funcionando.
- Release **coordenado**: o backend novo só vai a produção junto do app com o
  fluxo novo (avaliar versão mínima forçada).

## Checklist para o time do app

- [ ] Allowlist de hosts liberada para os domínios do R2 (dev e prod)
- [ ] Nenhuma URL de mídia de chat persistida como dado durável; refetch em `403`
- [ ] Geração de poster (frame → JPEG) implementada
- [ ] Passo 2 implementado como PUT cru com `Content-Type` idêntico ao declarado
- [ ] `durationMs`/`width`/`height` medidos e enviados no passo 3
- [ ] Retry do passo 3 reusa `key` + `Idempotency-Key` (sem assinatura nova)
- [ ] Fluxo testado contra o backend da branch `feat/storage-r2` em dev
