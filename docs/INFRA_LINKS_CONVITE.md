# Infra — links de convite (`clubber.social`)

Runbook da infraestrutura do link de convite compartilhável (PRs #210 backend
✅, #212 landing/app-links ✅, #128 mobile no clubber-app). Atualizado em
2026-08-25 após a validação em produção: **o apex está no ar e verde** — as
pendências restantes estão na tabela do fim.

Arquitetura real: o apex `clubber.social` hospeda o **site institucional**
(Cloudflare Workers Builds servindo estático, repo
[Clubber-Labs/clubber-institucional]); a API vive em `api.clubber.social`
(Coolify, atrás do proxy laranja da CF). As rotas do convite chegam à API por
um **Worker de proxy** (institucional PR #2) que intercepta `/e/*` e os dois
`.well-known` — rewrites de Next não existem em runtime de site estático (o
PR #1, que tentava por essa via, falhou no build e foi substituído).

---

## 1. DNS: `clubber.social` — ✅ FEITO

Apex resolve pela Cloudflare (NS `autumn/sri.ns.cloudflare.com`, proxy
laranja) e serve o site institucional. A API está em `api.clubber.social`
(`/health` 200).

## 2. TLS — ✅ FEITO

HTTPS válido no apex e na API via Cloudflare.

## 3. Roteamento apex → API — ✅ FEITO (Worker de proxy)

Worker do institucional (PR #2, `main` no `wrangler.jsonc`) intercepta:

- `/e/:token` → landing do convite
- `/.well-known/apple-app-site-association`
- `/.well-known/assetlinks.json`

e proxia para `api.clubber.social` **sem redirect** (requisito da Apple),
preservando os headers da API (`no-store` da landing confirmado). O Worker
sobrescreve (`set`) o `x-forwarded-for` com o `cf-connecting-ip` do visitante
— descarta XFF spoofado pelo cliente e deixa a cadeia
`visitante, <rede CF>, <Traefik>` para o passo 7 resolver.

## 4. Variáveis de ambiente — ✅ ATIVAS

`SHARE_BASE_URL=https://clubber.social` ativa desde o deploy do #212.

Opcionais (default correto no código):

```env
APPLE_TEAM_ID=K238P4B9K4
ANDROID_PACKAGE_NAME=com.netobonato.clubber
# CSV — aceita mais de um fingerprint (Play App Signing + build EAS)
ANDROID_CERT_SHA256=22:36:8C:18:AC:6F:70:89:DC:FC:7D:46:0A:66:0C:24:56:19:50:F3:DF:C4:84:79:01:EB:A0:CB:07:62:38:6D
PLAY_STORE_URL=https://play.google.com/store/apps/details?id=com.netobonato.clubber
# Quando o app estiver publicado na App Store (precisa do id numérico):
# APP_STORE_URL=https://apps.apple.com/app/id<NUMERO>
```

## 5. Validação pós-deploy — ✅ APEX VERDE (2026-08-25 ~05:25 UTC)

| Check | Resultado |
|---|---|
| `clubber.social/.well-known/apple-app-site-association` | ✅ 200, `application/json`, appIDs corretos, sem redirect |
| `clubber.social/.well-known/assetlinks.json` | ✅ 200, package + fingerprint |
| `clubber.social/e/<token>` | ✅ proxy end-to-end (landing da API, `no-store` preservado) |
| Cache CF nos paths | ✅ `cf-cache-status: DYNAMIC` (bypass rule ativa) |
| CDN da Apple (`app-site-association.cdn-apple.com/a/v1/clubber.social`) | ✅ servindo o AASA correto (re-buscou ao expirar o TTL, ~05:40 UTC) |

Comandos para revalidar quando precisar:

```bash
curl -si https://clubber.social/.well-known/apple-app-site-association | head -20
curl -si https://clubber.social/.well-known/assetlinks.json | head -20
curl -s  https://clubber.social/e/<token> | grep og:title
curl -s  "https://app-site-association.cdn-apple.com/a/v1/clubber.social" | head -5
# Android (após o app buildado com o intent filter):
#   https://developers.google.com/digital-asset-links/tools/generator
```

## 6. Cloudflare: cache e log do token — ✅ Cache Rule criada

- Cache Rule `bypass-links-convite` ativa na zona: **Bypass cache** para
  `starts_with /e/` OR `starts_with /.well-known/` — confirmada em produção
  (`DYNAMIC`). Foi ela que evitou o purge: o 404 antigo cacheado deixou de ser
  consultado quando o Worker subiu.
- Access logs (Cloudflare e Workers): não reter a URL completa de `/e/*` — no
  backend o token já é mascarado (`sanitizeLogUrl`).

**Por quê:** o token É a credencial de acesso ao evento privado; cache servindo
landing revogada anula a revogação, e log de proxy com o path entrega convites
vigentes.

## 7. TRUSTED_PROXIES — ❌ PENDENTE (último gate do backend)

A cadeia real é `visitante → Cloudflare (ou Worker) → Traefik → API`. O
backend resolve `request.ip` (usado pelo rate limit) via `trustProxy` do
Fastify ([src/server.ts]) alimentado pela env `TRUSTED_PROXIES` (CSV): o
X-Forwarded-For é percorrido da direita para a esquerda até o primeiro IP
**não**-confiável. **Fonte de verdade é o XFF — nunca `cf-connecting-ip`**,
que no fluxo do Worker é o IP do próprio Worker.

Como `api.clubber.social` já está atrás da CF, enquanto isso não for feito o
rate limit de TODAS as rotas opera em balde global — não é só o convite.

### A. Env na API (Coolify → app da API → Environment Variables)

```env
TRUSTED_PROXIES=127.0.0.1,172.16.0.0/12,10.0.0.0/8,173.245.48.0/20,103.21.244.0/22,103.22.200.0/22,103.31.4.0/22,141.101.64.0/18,108.162.192.0/18,190.93.240.0/20,188.114.96.0/20,197.234.240.0/22,198.41.128.0/17,162.158.0.0/15,104.16.0.0/13,104.24.0.0/14,172.64.0.0/13,131.0.72.0/22,2400:cb00::/32,2606:4700::/32,2803:f800::/32,2405:b500::/32,2405:8100::/32,2a06:98c0::/29,2c0f:f248::/32
```

(loopback + redes docker do Traefik + ranges publicados da Cloudflare; a rede
exata do Traefik sai de `docker network inspect coolify | grep Subnet`)

### B. Traefik (Coolify → Servers → Proxy → Configuration)

Sem isto o Traefik **descarta** o XFF vindo da CF e o reescreve com o IP dela
— o rate limit ficaria por IP da Cloudflare (baldes compartilhados). Nas
linhas `command:` do serviço traefik, adicionar (ajustar `http`/`https` para
os nomes reais dos entrypoints do compose):

```yaml
- '--entrypoints.http.forwardedHeaders.trustedIPs=173.245.48.0/20,103.21.244.0/22,103.22.200.0/22,103.31.4.0/22,141.101.64.0/18,108.162.192.0/18,190.93.240.0/20,188.114.96.0/20,197.234.240.0/22,198.41.128.0/17,162.158.0.0/15,104.16.0.0/13,104.24.0.0/14,172.64.0.0/13,131.0.72.0/22,2400:cb00::/32,2606:4700::/32,2803:f800::/32,2405:b500::/32,2405:8100::/32,2a06:98c0::/29,2c0f:f248::/32'
- '--entrypoints.https.forwardedHeaders.trustedIPs=<mesma lista>'
```

Salvar e **Restart Proxy**.

### C. Redeploy e validação

1. Redeploy da API (env só vale no restart).
2. `curl ifconfig.me` (teu IP) → `curl https://api.clubber.social/health` →
   conferir `remoteAddress` no log da API:
   - ✅ teu IP público → cadeia certa
   - ❌ `172.x`/`10.x` → env da API não pegou (passo A)
   - ❌ IP da Cloudflare → Traefik descartando XFF (passo B)
3. Repetir com `https://clubber.social/e/qualquer` (atravessa o Worker).

**Manutenção:** a lista da CF é estável, mas publicada em
<https://www.cloudflare.com/ips/> — se o rate limit "enlouquecer" sem mudança
nossa, o primeiro suspeito é range novo fora da lista.

## 8. Build nativo do app (clubber-app PR #128)

Com o passo 7 feito e o CDN da Apple atualizado: merge do #128 e build novo
via EAS (`associatedDomains` iOS + `intentFilters` Android). Configuração
nativa **não** entra por OTA — build antigo nunca abre o link direto.

O fluxo por custom scheme (`clubber://invites/<token>`) não depende de nada
disso e já é testável em dev.

---

## Estado (2026-08-25 ~05:30 UTC)

| Item | Status |
|---|---|
| Backend (link + accept + landing + `.well-known`) | ✅ #210 e #212 mergeados e **deployados** |
| DNS/TLS do apex | ✅ |
| Worker de proxy apex → API | ✅ institucional PR #2 deployado, **validado em produção** |
| `SHARE_BASE_URL` | ✅ ativa |
| Cache Rule de bypass na CF | ✅ ativa e confirmada (`DYNAMIC`) |
| CDN da Apple | ✅ AASA no ar (verificado ~05:40 UTC) |
| `TRUSTED_PROXIES` (API + Traefik) | ❌ **único gate restante do backend** — passo 7 |
| App mobile | 🟡 PR #128 aberto; custom scheme testável já; build EAS após passo 7 + CDN Apple |

[Clubber-Labs/clubber-institucional]: https://github.com/Clubber-Labs/clubber-institucional
[src/server.ts]: ../src/server.ts
