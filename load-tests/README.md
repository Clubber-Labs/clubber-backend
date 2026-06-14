# Testes de carga — ConnectAI Backend (k6)

Suíte de testes de carga usada para evidenciar empiricamente o desempenho da API
sob diferentes regimes de tráfego. Os resultados (latência p50/p95/p99,
throughput e taxa de erro) servem de base para o capítulo de avaliação do TCC.

Ferramenta: **[k6](https://grafana.com/docs/k6/)** (Grafana). Escolhida por
gerar percentis e thresholds prontos para citação, suportar múltiplos tipos de
cenário (carga, stress, spike, arrival-rate) e exportar os resultados em JSON.

---

## Pré-requisitos

1. **Instalar o k6** (binário, não é pacote npm):
   <https://grafana.com/docs/k6/latest/set-up/install-k6/>
   ```bash
   k6 version   # confirma a instalação
   ```

2. **Subir a infraestrutura** (PostgreSQL/PostGIS + Redis):
   ```bash
   docker-compose up -d
   ```

3. **Popular o banco**:
   ```bash
   pnpm db:seed                          # usuários + ~50 eventos
   tsx load-tests/seed-loadtest.ts       # +5000 eventos públicos (recomendado)
   # EVENTS=20000 tsx load-tests/seed-loadtest.ts   # para volumes maiores
   ```
   O seed cria os usuários `admin@conectai.dev` e `premium@conectai.dev`
   (senha `senha123`), usados no cenário autenticado.

4. **Subir a API.** Para os cenários de desempenho puro, desligue o rate limit
   (senão os `429` poluem latência/throughput):
   ```bash
   RATE_LIMIT_ENABLED=false pnpm dev
   ```
   > O toggle `RATE_LIMIT_ENABLED` e o `RATE_LIMIT_MAX_FACTOR` foram adicionados
   > justamente para isso (ver `.env.example`). A **demonstração de rate limit**
   > (cenário 05) é a exceção: roda nas duas configurações.

---

## Cenários

| # | Arquivo | Endpoint | Objetivo |
|---|---------|----------|----------|
| 00 | `00-smoke.js` | `GET /health` | Sanidade + linha de base de latência (1 VU) |
| 01 | `01-geo-baseline.js` | `GET /events/map/events` | Carga sustentada na query geográfica (PostGIS) |
| 02 | `02-geo-stress.js` | `GET /events/map/events` | Rampa crescente até achar o ponto de quebra |
| 03 | `03-spike.js` | `GET /events/map/events` | Pico súbito de tráfego (arrival-rate) |
| 04 | `04-authenticated.js` | `GET /feed`, `GET /events` | Caminho real autenticado (login + Bearer) |
| 05 | `05-rate-limit-demo.js` | `GET /events/search` | Comprovação do throttling (429 com/sem limite) |
| 06 | `06-cluster-scale.js` | `GET /events/map/events` | Escala horizontal (cluster nginx — ver seção abaixo) |

`GET /events/map/events` é o alvo principal: é o endpoint mais pesado (consulta
PostGIS de bounding box + hidratação completa dos eventos), o melhor para
estressar o backend.

---

## Como rodar

### Tudo de uma vez (cenários 00–04)
Com a API no ar (`RATE_LIMIT_ENABLED=false pnpm dev`):
```bash
bash load-tests/run-all.sh
```
Os summaries vão para `load-tests/results/*.json`.

### Cenário individual
```bash
# K6_SUMMARY_TREND_STATS inclui o p99 no summary (o k6 só traz até p95 por padrão).
K6_SUMMARY_TREND_STATS="avg,min,med,max,p(90),p(95),p(99)" \
  k6 run -e K6_BASE_URL=http://localhost:3333 load-tests/01-geo-baseline.js
# parâmetros opcionais por cenário:
k6 run -e VUS=50 -e DURATION=2m load-tests/01-geo-baseline.js
```
(os scripts `run-all.sh` / `run-rate-limit.sh` já exportam essa variável.)

### Demonstração de rate limit (cenário 05) — o experimento das duas fases
Roda o mesmo cenário contra a API em dois estados e compara a fração de `429`:

```bash
# Fase OFF — sem throttling (espera-se 0% de 429)
RATE_LIMIT_ENABLED=false pnpm dev        # num terminal
PHASE=off bash load-tests/run-rate-limit.sh

# Fase ON — com throttling no teto de 30/min (espera-se alta fração de 429)
pnpm dev                                  # default: RATE_LIMIT_ENABLED=true
PHASE=on  bash load-tests/run-rate-limit.sh
```
Gera `results/05-rate-limit-demo-off-summary.json` e `-on-summary.json`.

---

## Lendo os resultados

Cada execução imprime no terminal um bloco com requisições, p50/p95/p99,
latência máxima e taxa de erro, e grava o JSON completo do k6 em
`results/<cenário>-summary.json` (métricas em `.metrics.<nome>.values`).

Métricas-chave:
- `http_req_duration` → `med` (p50), `p(95)`, `p(99)`, `max` — em ms.
- `http_reqs` → `count`, `rate` (req/s = throughput).
- `http_req_failed` → `rate` (fração de respostas com erro).
- `rate_limited` (só no cenário 05) → fração de `429`.

### Tabela-modelo para o documento

Preencher com os valores extraídos dos summaries:

| Cenário | VUs / Rate | Throughput (req/s) | p50 (ms) | p95 (ms) | p99 (ms) | Erro % |
|---------|-----------|--------------------|----------|----------|----------|--------|
| Smoke (baseline) | 1 VU | | | | | |
| Geo baseline | 20 VUs | | | | | |
| Geo stress | →300 VUs | | | | | |
| Spike | →500 req/s | | | | | |
| Autenticado | 20 VUs | | | | | |

**Demonstração de rate limiting** (`GET /events/search`, teto 30/min):

| Fase | Configuração | Throughput | 429 % | Erro % |
|------|--------------|-----------|-------|--------|
| OFF | `RATE_LIMIT_ENABLED=false` | | ~0% | |
| ON  | `RATE_LIMIT_ENABLED=true` | | | |

### Reprodutibilidade (registrar no TCC)
- Versão do k6 (`k6 version`) e commit do backend (`git rev-parse --short HEAD`).
- Hardware/SO da máquina de teste e onde rodavam API e banco (mesma máquina?).
- Volume de dados (`EVENTS=` usado no `seed-loadtest.ts`).
- Os SLOs usados como threshold estão em cada script e em `lib/helpers.js`
  (`DEFAULT_THRESHOLDS`: p95 < 500 ms, erro < 1%).

---

## Escala horizontal (cluster)

Para evidenciar o **RNF05.1** (escalabilidade horizontal), a aplicação foi containerizada
(`Dockerfile`) e o `docker-compose.yml` ganhou um **perfil `cluster`**: N réplicas da API
(1 vCPU cada) atrás de um **load balancer** (nginx, *round-robin*), compartilhando o mesmo
Postgres/Redis. O cenário `06-cluster-scale.js` aplica uma taxa de chegada fixa ao endpoint
geoespacial e é rodado com 1, 2 e 3 réplicas para comparar o ganho.

**Pré-requisito adicional:** o serviço `api` usa `env_file: .env.local`. Garanta que esse
arquivo exista na raiz do backend com os segredos de dev (Stripe, Cloudinary etc.) que o
`env.ts` exige no boot — copie de `.env.example` e preencha. Sem ele o `docker compose` falha
na subida (`env file .env.local: no such file or directory`).

```bash
# sobe o cluster (perfil `cluster`); o override evita conflito de porta do Redis
docker compose -f docker-compose.yml -f load-tests/docker-compose.cluster-override.yml \
  --profile cluster up --build --scale api=1 -d      # depois --scale api=2, api=3

# aplica a carga apontando para o LB (não para uma réplica)
k6 run -e K6_BASE_URL=http://localhost:3333 -e VUS=50 load-tests/06-cluster-scale.js
docker stats   # CPU por réplica durante o teste
```

| Réplicas | RPS sustentado | p95 | Erro % | CPU por réplica |
|----------|----------------|-----|--------|-----------------|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |

> **Captura das figuras (Grafana):** o `docker-compose.observability.yml` inclui o
> `grafana-image-renderer`, permitindo exportar os painéis em PNG via `GET /render/d-solo/...`
> (latência p50/p95/p99, throughput, erro, in-flight, processo) para a janela exata do teste.
>
> **Condições do ensaio / ressalva:** esta medição roda **na máquina do desenvolvedor**, com
> **todos os componentes na mesma máquina** (gerador k6 + réplicas + Postgres + Redis + nginx +
> observabilidade), sem isolamento de recursos nem nuvem. É uma **validação de escala reduzida**:
> o objetivo é provar o *mecanismo* (a arquitetura escala?) e a *tendência* de ganho ao adicionar
> réplicas — não o número absoluto. Como os componentes disputam a mesma CPU/memória, os valores
> são um **limite inferior conservador** (latência inflada, vazão limitada pelo host); em nós
> dedicados na nuvem tende a ir melhor. A validação do alvo de 10.000 usuários do RNF01.4 exige
> nós físicos independentes + balanceador gerenciado (AWS ELB + Auto Scaling), no deploy de
> produção. **Registre as specs da máquina** (CPU/RAM/SO) ao anotar os números na tabela acima.
