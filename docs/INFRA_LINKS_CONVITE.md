# Infra pendente — links de convite (`clubber.social`)

Pendências de infraestrutura para o link de convite compartilhável funcionar de
ponta a ponta (PRs #210 backend ✅, #212 landing/app-links, #128 mobile no
clubber-app). O código está pronto; o quadro abaixo reflete o que já foi
verificado/executado em 2026-08-25.

Arquitetura real (diferente do plano original): o apex `clubber.social` hospeda
o **site institucional Next.js** ([Clubber-Labs/clubber-institucional]) atrás da
Cloudflare (proxy laranja); a API de produção vive em `api.clubber.social`. As
rotas do convite chegam à API por **rewrites do Next** — proxy, não redirect.

Ordem: os passos 1–4 estão feitos ou resolvidos no código; os gates atuais são
**deploy do #212**, **deploy do site institucional** e o **passo 7
(TRUSTED_PROXIES)**, que subiu de configuração fina para pré-requisito. O PR
#128 (mobile) só deve gerar build depois do passo 5 passar.

---

## 1. DNS: apontar `clubber.social` — ✅ FEITO

Verificado via `dig`/`curl`: o apex resolve pela Cloudflare (NS
`autumn/sri.ns.cloudflare.com`, proxy laranja) e serve o site institucional.
A API **não** está no apex — está em `api.clubber.social` (`/health` 200).

**Por quê importava:** o link compartilhado é
`https://clubber.social/e/<token>`, e Apple/Google baixam os arquivos de
verificação desse host exato.

## 2. TLS: certificado válido — ✅ FEITO

HTTPS válido no apex via Cloudflare. Nada a fazer.

## 3. Roteamento: apex → API — ✅ RESOLVIDO NO CÓDIGO (pendente deploy do site)

**Como ficou:** `rewrites()` no `next.config.ts` do site institucional (PR #1
do clubber-institucional, mergeado em 2026-08-25) proxiando para
`https://api.clubber.social`:

- `/e/:token`
- `/.well-known/apple-app-site-association`
- `/.well-known/assetlinks.json`

Rewrite é proxy **sem redirect** — atende o requisito da Apple (o AASA não pode
responder 301/302). Validado com `next start` local: os três paths chegam na
API de produção.

**Pendente:** deploy do site institucional com esse PR.

**Por quê:** os três endpoints são rotas do Fastify (PR #212); o site no apex
precisa encaminhá-los à API sem interceptar.

## 4. Variáveis de ambiente em produção — ✅ CADASTRADA (vale no próximo redeploy)

`SHARE_BASE_URL=https://clubber.social` já está no Coolify; passa a valer no
redeploy da API — que deve ser o deploy do #212.

Opcionais (default correto no código, sobrescrever só se mudar):

```env
APPLE_TEAM_ID=K238P4B9K4
ANDROID_PACKAGE_NAME=com.netobonato.clubber
# CSV — aceita mais de um fingerprint (Play App Signing + build EAS)
ANDROID_CERT_SHA256=22:36:8C:18:AC:6F:70:89:DC:FC:7D:46:0A:66:0C:24:56:19:50:F3:DF:C4:84:79:01:EB:A0:CB:07:62:38:6D
PLAY_STORE_URL=https://play.google.com/store/apps/details?id=com.netobonato.clubber
# Quando o app estiver publicado na App Store (precisa do id numérico):
# APP_STORE_URL=https://apps.apple.com/app/id<NUMERO>
```

## 5. Validação pós-deploy (gate para o build do #128)

**Pré-requisitos:** merge+deploy do #212 na API (hoje o AASA em
`api.clubber.social` responde "Route not found"), deploy do site institucional
(passo 3) e passo 7 resolvido.

```bash
# 1) AASA: 200, application/json, appID K238P4B9K4.com.netobonato.clubber
curl -si https://clubber.social/.well-known/apple-app-site-association | head -20

# 2) assetlinks: 200, package com.netobonato.clubber + fingerprint SHA-256
curl -si https://clubber.social/.well-known/assetlinks.json | head -20

# 3) Nenhum redirect no caminho (200 direto, sem 301/302)
curl -sI https://clubber.social/.well-known/apple-app-site-association | grep -i "HTTP\|location"

# 4) Landing: gerar um link real (POST /events/:id/invite-links) e abrir
curl -s https://clubber.social/e/<token> | grep og:title

# 5) Verificação do Google (depois do app buildado com o intent filter):
#    https://developers.google.com/digital-asset-links/tools/generator
# 6) Verificação da Apple (o CDN dela precisa enxergar o arquivo):
curl -s "https://app-site-association.cdn-apple.com/a/v1/clubber.social" | head -5
```

**Por quê:** a Apple baixa o AASA via CDN próprio e **cacheia por horas/dias** —
subir com o arquivo errado significa esperar o cache expirar para testar de
novo. Validar antes do build economiza esse ciclo.

## 6. Cloudflare/proxies: cache e log do token

**O que fazer:**
- **Cache da Cloudflare em `/e/*`:** o 404 atual do site sai com
  `cf-cache-status: HIT`. Pós-deploy, conferir que `/e/*` **não** é cacheado
  (a API manda `Cache-Control: no-store`); se aparecer `HIT` ali, criar Cache
  Rule de **bypass** para `/e/*` e `/invites/*`.
- Access logs (Cloudflare e host do site): não reter a URL completa de `/e/*`
  (o backend já mascara nos logs próprios via `sanitizeLogUrl`).

**Por quê:** o token do link É a credencial de acesso ao evento privado; cache
servindo landing revogada anula a revogação, e log de proxy guardando o path
entrega convites vigentes.

## 7. TRUSTED_PROXIES — ⚠️ PRÉ-REQUISITO (subiu de configuração fina)

Com o rewrite do Next, **todo** request de `/e/*` e `/.well-known/*` chega à
API com o IP de egress do servidor do site institucional — não o do visitante.

**O que fazer, antes de considerar o passo 5 verde:**
1. Descobrir onde o site institucional roda e qual o IP (ou faixa) de egress.
2. Confirmar que o Next/host repassa `X-Forwarded-For` com o IP real do
   visitante.
3. Cadastrar esse IP/CIDR em `TRUSTED_PROXIES` na API (Coolify).

**Por quê:** o rate limit do preview/landing (60/min) e do accept (20/min) é
por IP. Sem o egress do site em `TRUSTED_PROXIES`, todos os visitantes contam
no MESMO balde (o IP do site) — a landing morre com pouco tráfego legítimo.

## 8. Depois da infra: build nativo do app

Com os passos 3–5 e 7 verdes e o PR #128 (clubber-app, branch
`feat/deep-link-convite`) mergeado, gerar build novo via EAS
(`associatedDomains` iOS + `intentFilters` Android).

**Por quê:** configuração nativa entra só em build novo, **não** via OTA. App
de build antigo nunca abre o link direto.

---

## Estado atual (2026-08-25, fim do dia)

| Item | Status |
|---|---|
| Código backend (link + accept) | ✅ PR #210 mergeado |
| Landing + `.well-known` | 🟡 PR #212 aprovado, aguardando merge+deploy |
| DNS/TLS do apex | ✅ Cloudflare, site institucional no ar |
| Roteamento apex → API | 🟡 rewrites mergeados (institucional PR #1), aguardando deploy do site |
| `SHARE_BASE_URL` em produção | 🟡 cadastrada no Coolify, vale no próximo redeploy |
| `TRUSTED_PROXIES` (egress do site) | ❌ pendente — **gate do passo 5** |
| Cache Rule de bypass `/e/*` na Cloudflare | ❌ conferir pós-deploy |
| App mobile | 🟡 PR #128 do clubber-app aberto — build bloqueado pelo passo 5 |

[Clubber-Labs/clubber-institucional]: https://github.com/Clubber-Labs/clubber-institucional
