# Observabilidade — stack local (Grafana)

Stack self-hosted para visualizar métricas, traces e logs do backend:

| Sinal      | Coleta             | Backend             | Visualização |
| ---------- | ------------------ | ------------------- | ------------ |
| Métricas   | Prometheus (pull)  | Prometheus          | Grafana      |
| Traces     | OTLP (push)        | Grafana Tempo       | Grafana      |
| Logs       | pino-loki (push)   | Grafana Loki        | Grafana      |
| Erros      | SDK Sentry         | GlitchTip (local)   | GlitchTip    |

O backend roda no **host** (`pnpm dev`); a stack roda em containers e fala com o
host via `host.docker.internal`.

## Subir a stack

```bash
docker compose -f observability/docker-compose.observability.yml up -d
```

- Grafana: http://localhost:3000 (login anônimo como Admin, ou `admin`/`admin`)
- Prometheus: http://localhost:9090
- Tempo: http://localhost:3200 · Loki: http://localhost:3100
- GlitchTip (erros): http://localhost:8000

Datasources (Prometheus, Tempo, Loki) e o dashboard **ConnectAI Backend** já vêm
provisionados.

## GlitchTip (rastreio de erros, compatível com Sentry)

Sobe junto com a stack: Postgres + Redis próprios, `glitchtip-web` (porta 8000),
`glitchtip-worker` e um job `glitchtip-migrate`. O SDK `@sentry/node` do backend
funciona sem mudança — só muda o `SENTRY_DSN`.

**Obter um DSN** (já existe um projeto inicial provisionado, veja abaixo):

1. Abra http://localhost:8000 e logue (ou crie conta via *Sign Up*).
2. Crie uma **Organização** e um **Projeto** (tipo Node).
3. O **DSN** aparece em *Project Settings → DSN*, no formato
   `http://<PUBLIC_KEY>@localhost:8000/<PROJECT_ID>`.
4. Cole no `.env.local` em `SENTRY_DSN=` e reinicie o `pnpm dev`.

> Como o backend roda no host e o web publica `8000:8000`, o DSN usa
> `localhost:8000` (não nome de serviço do compose).

**Verificar o ingest** (sem o backend, via API Sentry-compatível):

```bash
curl -i http://localhost:8000/api/<PROJECT_ID>/store/ \
  -H 'Content-Type: application/json' \
  -H 'X-Sentry-Auth: Sentry sentry_version=7, sentry_key=<PUBLIC_KEY>' \
  -d '{"event_id":"'$(openssl rand -hex 16)'","message":"smoke test","level":"error","platform":"node"}'
```

`200` + `{"id": "..."}` = aceito; em segundos aparece em *Issues* (o `worker`
processa). UI vazia mas `200` no ingest = worker parado → `docker logs connectai-glitchtip-worker`.

## Ligar a instrumentação no backend

No `.env.local` (veja `.env.example`):

```env
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=connectai-backend
LOKI_URL=http://localhost:3100
# erros → GlitchTip local (ver seção GlitchTip para obter o DSN)
SENTRY_DSN=http://<PUBLIC_KEY>@localhost:8000/<PROJECT_ID>
```

Reinicie o `pnpm dev`. As **métricas** em `/metrics` independem dessas envs
(sempre ligadas). **Traces** vão para o Tempo, **logs** para o Loki — e como o
OpenTelemetry injeta `trace_id` nos logs, o Grafana correlaciona log ↔ trace.

## Verificação rápida

```bash
curl -s localhost:3333/metrics | head
curl -i localhost:3333/health/ready
curl -i -H 'x-request-id: trace-abc-1' localhost:3333/health   # ecoa o header
```

Gere tráfego (ex.: `curl localhost:3333/health` algumas vezes) e abra o dashboard
no Grafana. Para traces, bata em uma rota que toca o banco e explore o datasource
Tempo; clique no `trace_id` de um log no Loki para pular ao trace.

## Notas

- Em `NODE_ENV=test` toda a instrumentação é no-op (e o `buildApp()` dos testes
  nem importa o bootstrap), então `pnpm test` não é afetado.
- `/metrics` fica aberto por padrão (modelo pull). Para proteger, defina
  `METRICS_TOKEN` no backend (e o mesmo token no scrape do Prometheus) ou
  restrinja na borda de rede. `METRICS_ENABLED=false` desliga o endpoint.
- Coleta de logs via `pino-loki` (push direto) é adequada para esta escala; um
  coletor lendo o stdout dos containers (Grafana Alloy) é o upgrade futuro.

## ⚠️ Esta stack é para DESENVOLVIMENTO LOCAL

Não suba este compose em produção sem ajustes. Especificamente:

- **Grafana** está com login anônimo como `Admin` e senha `admin/admin` — só
  aceitável numa máquina local. Em produção, remova `GF_AUTH_ANONYMOUS_*` e use
  uma senha forte.
- **GlitchTip** usa `SECRET_KEY` com default de dev (baixa entropia). Para
  qualquer ambiente não-local, defina `GLITCHTIP_SECRET_KEY` no ambiente.
- O Redis/Valkey do GlitchTip é **broker/cache efêmero** (sem volume, como no
  sample oficial): num restart, eventos ainda na fila podem se perder. Os dados
  persistidos (issues, projetos) ficam no Postgres, que tem volume.
