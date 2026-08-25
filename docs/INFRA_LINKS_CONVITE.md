# Infra pendente — links de convite (`clubber.social`)

Pendências de infraestrutura para o link de convite compartilhável funcionar de
ponta a ponta (PRs #210 backend, #212 landing/app-links, PR 3 mobile). O código
está pronto; **nada disso funciona em produção até os passos abaixo**.

Ordem de execução: os passos 1–4 são pré-requisito do deploy; o 5 valida; os
demais são configuração fina. O PR 3 (mobile) só deve gerar build depois do
passo 5 passar.

---

## 1. DNS: apontar `clubber.social` para o backend

**O que fazer:**
- No provedor do domínio, criar o registro do apex `clubber.social` apontando
  para a infra onde a API roda:
  - IP fixo → registro `A` (e `AAAA` se houver IPv6)
  - Hostname do provedor (LB/Coolify/edge) → `ALIAS`/`ANAME` (apex não aceita
    `CNAME` na maioria dos provedores)
- Se a API ficar em subdomínio próprio (ex.: `api.clubber.social`), o apex
  ainda precisa resolver para um proxy que encaminhe ao MESMO app — as rotas
  `/e/*` e `/.well-known/*` são servidas pelo Fastify, não são arquivos
  estáticos hospedados à parte.

**Por quê:** o link compartilhado é `https://clubber.social/e/<token>`, e Apple
e Google baixam os arquivos de verificação desse host exato.

## 2. TLS: certificado HTTPS válido para `clubber.social`

**O que fazer:**
- Emitir/ativar o certificado no proxy que atende o domínio (Let's Encrypt
  automático no Coolify/Traefik/Caddy; ou o cert gerenciado do provedor).
- Conferir que `https://clubber.social` abre sem QUALQUER erro de certificado
  (nome, cadeia, validade).

**Por quê:** Universal Links (iOS) e App Links (Android) **exigem** HTTPS sem
erro — com cert inválido a verificação falha em silêncio e o link passa a abrir
só o browser, para sempre.

## 3. Roteamento: host → serviço do backend

**O que fazer:**
- No proxy/ingress, rotear `clubber.social` para o serviço da API (o mesmo
  container/app da API principal).
- Garantir que estas rotas chegam ao Fastify sem redirect e sem autenticação de
  borda na frente:
  - `GET /e/*` (landing do convite)
  - `GET /.well-known/apple-app-site-association`
  - `GET /.well-known/assetlinks.json`
- Sem redirect é literal: a Apple não segue redirect ao baixar o
  `apple-app-site-association` — regras tipo "força www" ou "apex → app" não
  podem se aplicar a esse path.

**Por quê:** os três endpoints nasceram no PR #212 como rotas da API; qualquer
camada que intercepte (redirect, auth de borda, página de manutenção) quebra a
verificação dos deep links.

## 4. Variáveis de ambiente em produção

**O que fazer:** no ambiente de produção da API, definir:

```env
SHARE_BASE_URL=https://clubber.social
```

Opcionais (têm default correto no código, sobrescrever só se mudar):

```env
APPLE_TEAM_ID=K238P4B9K4
ANDROID_PACKAGE_NAME=com.netobonato.clubber
# CSV — aceita mais de um fingerprint (Play App Signing + build EAS)
ANDROID_CERT_SHA256=22:36:8C:18:AC:6F:70:89:DC:FC:7D:46:0A:66:0C:24:56:19:50:F3:DF:C4:84:79:01:EB:A0:CB:07:62:38:6D
PLAY_STORE_URL=https://play.google.com/store/apps/details?id=com.netobonato.clubber
# Quando o app estiver publicado na App Store (precisa do id numérico):
# APP_STORE_URL=https://apps.apple.com/app/id<NUMERO>
```

**Por quê:** `SHARE_BASE_URL` é o host que o backend usa para montar a URL de
compartilhamento; sem ela cai no `PUBLIC_URL` (a URL da API), e o link
compartilhado sai errado. Sem `APP_STORE_URL` o botão iOS da landing
simplesmente não renderiza (comportamento intencional).

## 5. Validação pós-deploy (gate para o PR 3)

**O que fazer:** rodar e conferir cada um:

```bash
# 1) AASA: 200, content-type application/json, appID K238P4B9K4.com.netobonato.clubber
curl -si https://clubber.social/.well-known/apple-app-site-association | head -20

# 2) assetlinks: 200, package com.netobonato.clubber + fingerprint SHA-256
curl -si https://clubber.social/.well-known/assetlinks.json | head -20

# 3) Nenhum redirect no caminho (deve ser 200 direto, sem 301/302)
curl -sI https://clubber.social/.well-known/apple-app-site-association | grep -i "HTTP\|location"

# 4) Landing: gerar um link real (POST /events/:id/invite-links) e abrir
curl -s https://clubber.social/e/<token> | grep og:title

# 5) Verificação do Google (depois do app buildado com o intent filter):
#    https://developers.google.com/digital-asset-links/tools/generator
# 6) Verificação da Apple (o CDN dela precisa enxergar o arquivo):
curl -s "https://app-site-association.cdn-apple.com/a/v1/clubber.social" | head -5
```

**Por quê:** a Apple baixa o AASA via CDN próprio e **cacheia por horas/dias** —
subir com o arquivo errado significa esperar o cache expirar (ou re-instalar o
app) para testar de novo. Validar antes do build economiza esse ciclo.

## 6. Proxy/CDN: log e cache do token

**O que fazer:**
- Access log do proxy: não logar a URL completa de `/e/*` e `/invites/*` (ou
  mascarar o path). No backend isso já está resolvido (`sanitizeLogUrl`).
- Se houver CDN/cache na frente: garantir que `Cache-Control: no-store` (que a
  API já envia na landing e no preview) é respeitado — não configurar override
  de cache para essas rotas.

**Por quê:** o token do link É a credencial de acesso ao evento privado; um
access log de proxy guardando o path entrega convites vigentes a quem lê o log,
e um cache servindo landing revogada anula a revogação.

## 7. Rate limit atrás do proxy novo

**O que fazer:** se a rota `clubber.social` introduzir um proxy que ainda não
está em `TRUSTED_PROXIES`, adicionar o IP/CIDR dele à env.

**Por quê:** o rate limit do preview (60/min) e do accept (20/min) é por IP;
sem o proxy na lista, todos os requests chegam com o IP do proxy e o limite
vira um balde global — throttling errado para usuários legítimos.

## 8. Depois da infra: build nativo do app

**O que fazer:** com os passos 1–5 verdes e o PR 3 (mobile) mergeado, gerar
build novo via EAS (`associatedDomains` iOS + `intentFilters` Android).

**Por quê:** essas configurações são nativas — entram só em build novo, **não**
via atualização OTA. App instalado de build antigo nunca abre o link direto.

---

## Estado atual (2026-08-25)

| Item | Status |
|---|---|
| Código backend (link + accept) | ✅ PR #210 mergeado |
| Landing + `.well-known` | 🟡 PR #212 aberto |
| DNS/TLS/roteamento `clubber.social` | ❌ pendente (passos 1–3) |
| `SHARE_BASE_URL` em produção | ❌ pendente (passo 4) |
| App mobile (PR 3) | ❌ não iniciado — bloqueado pelo passo 5 |
