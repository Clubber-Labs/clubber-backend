# Resultados de referência — testes de carga

> Execução de referência rodada na máquina de desenvolvimento. **Reproduza no
> seu ambiente** (idealmente com API e banco compilados/isolados) e substitua os
> números antes de citar no TCC — os valores absolutos dependem do hardware.

## Ambiente

| Item | Valor |
|------|-------|
| Backend (commit base) | `fa2b56d` (branch `feat/rate-limit-env-load-tests`) |
| API | build compilado (`pnpm build` → `node dist/server.js`) |
| Runtime | Node.js v24.14.1 |
| Banco | PostgreSQL 16 + PostGIS 3.4 (docker-compose), mesma máquina |
| Cache/Redis | desabilitado (`cache: disabled`) — rate limit em store de memória |
| Ferramenta | k6 v1.7.1 |
| CPU / cores | AMD Ryzen 5 3500U / 8 |
| SO | Linux 7.0.9-zen1 |
| Volume de dados | ~5.000 eventos públicos na região de Curitiba (`seed-loadtest.ts`) |
| Carga | API, banco e k6 na MESMA máquina (cenário pessimista) |

## Desempenho por cenário

| Cenário | Carga | Throughput (req/s) | p50 (ms) | p95 (ms) | p99 (ms) | Erro % |
|---------|-------|--------------------|----------|----------|----------|--------|
| 00 Smoke (`/health`) | 1 VU | 268 | 3 | 5 | 8 | 0.00 |
| 01 Geo baseline (`/events/map/events`) | 20 VUs | 21 | 929 | 1236 | 1351 | 0.00 |
| 02 Geo stress (rampa →300 VUs) | 0→300 VUs | 25 | 3214 | 6658 | 53908 | 0.41 |
| 03 Spike (`/events/map/events`) | →500 req/s | 26 | 3356 | 60000 | 60004 | 12.45 |
| 04 Autenticado (`/feed`+`/events`) | 20 VUs | 29 | 604 | 1119 | 1248 | 0.00 |

Leitura:
- O `/health` (sem I/O) sustenta ~268 req/s com latência ~3 ms — teto de overhead
  do framework.
- A query geográfica de viewport (`/events/map/events`, PostGIS + hidratação de
  até 200 eventos) é o **gargalo**: satura em ~20–25 req/s com latência ~0,9–1 s.
- Sob stress/spike o endpoint geo atinge o ponto de saturação (latências de
  segundos a timeout), evidenciando o limite de capacidade de um único processo.

> **Modelo de carga (declarar na defesa):** o cenário autenticado usa **um único
> usuário compartilhado** (`premium@conectai.dev`) — o `setup()` loga uma vez e
> todos os VUs reusam o mesmo JWT, com **think time = 0**. Isso é carga
> sintética de stress, não tráfego multi-usuário realista: o feed personalizado
> retorna o mesmo conteúdo (favorecendo cache) e um eventual rate limit por
> usuário incidiria sobre um só `sub`. Para números representativos de produção,
> usar uma pool de usuários e think time > 0.

## Demonstração do rate limiting (`GET /events/search`, teto 30/min)

Mesmo cenário (50 req/s por 30 s = 1.501 requisições) contra a API nas duas configs:

| Fase | Config | Throughput | Respostas 429 | p50 (ms) |
|------|--------|-----------|---------------|----------|
| OFF | `RATE_LIMIT_ENABLED=false` | 49.9 req/s | **0.00 %** | 35 |
| ON  | `RATE_LIMIT_ENABLED=true` (default) | 50.0 req/s | **98.33 %** | 2 |

Com o limite ligado, apenas ~25 requisições (o teto de 30/min) são atendidas com
`200`; as demais recebem `429 Too Many Requests`. Comprova que o throttling
configurável por env protege o endpoint sob abuso — e que desligá-lo (para os
testes de carga) elimina os `429` das métricas.
