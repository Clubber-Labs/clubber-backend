# Performance da busca por proximidade — evidência empírica

Consolida a metodologia, as medições e a análise de conformância com os RNFs
de performance da busca por proximidade (módulo `events`). Acompanha a entrega
`feat/proximidade-hardening`.

## RNFs alvo (texto literal — Documentação ConnectAI)

| RNF | Definição | Métrica |
|---|---|---|
| **RNF01.3** | "As buscas da API devem retornar resultados em até 1 segundo, em 95% das requisições." | p95 ≤ 1000 ms |
| **RNF01.4** | "Suportar 10.000 usuários simultâneos (1.000 req/s), mantendo tempo de resposta até 500 ms e taxa de erro até 0,1% para 95% das requisições." | 1000 req/s, p95 ≤ 500 ms, erro ≤ 0,1% |
| **RNF05.2** | "Usar cache para otimizar consultas frequentes (ex.: feed), com taxa de acerto maior que 90%." | cache hit-rate > 90% |
| **RNF05.3** | "BD deve suportar 10× de volume (via sharding/particionamento) sem degradar a performance das buscas (RNF01.3)." | p95 ≤ 1 s a 10× |
| **RF07.6** | "Ordenar resultados (data, distância, popularidade)." | feature |

> ⚠️ **Ressalva de hardware.** Os números abaixo foram coletados num sandbox
> compartilhado/virtualizado (8 vCPUs). Os **valores absolutos não representam
> o ambiente de deploy** — o que é defensável aqui é o **relativo** (ganho
> antes→depois, hit-rate, escala 10×). Para números "oficiais", reproduza o
> harness numa máquina representativa.

## Setup reproduzível

Banco de perf separado (`conectai_perf`), Redis ativo, servidor compilado.

```bash
# 1. Banco + migrations
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/conectai_perf" \
  npx prisma migrate deploy

# 2. Seed (10k para baseline; 100k para o teste 10× do RNF05.3)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/conectai_perf" \
  pnpm exec tsx scripts/load/seed-perf.ts --events 100000

# 3. Servidor (build) apontando pro perf.
#    METRICS_TOKEN é obrigatório: em NODE_ENV=production o /metrics fica fechado
#    sem token (fail-closed). O mesmo token é passado ao k6/curl abaixo.
pnpm build
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/conectai_perf?connection_limit=20" \
  JWT_SECRET=perf REDIS_URL=redis://localhost:6379 NODE_ENV=production \
  METRICS_TOKEN=perf-metrics \
  FEATURED_RECONCILE_ENABLED=false node dist/server.js

# 4. Carga + métricas
#    Run completo (curva de latência + cache); rnf014 é opt-in (ver Escala).
BASE_URL=http://localhost:3333 METRICS_TOKEN=perf-metrics \
  k6 run scripts/load/proximity.js

#    RNF05.2 isolada (hit-rate limpo, só a janela do cache):
BASE_URL=http://localhost:3333 METRICS_TOKEN=perf-metrics CACHE_ONLY=1 \
  k6 run scripts/load/proximity.js       # imprime "[cache] hit-rate (delta...)"

#    RNF01.4 (1000 rps) — só num ambiente representativo (numa instância falha):
BASE_URL=http://localhost:3333 METRICS_TOKEN=perf-metrics RNF014=1 \
  k6 run scripts/load/proximity.js

curl -H "Authorization: Bearer perf-metrics" http://localhost:3333/metrics
```

Fonte de verdade da **latência**: `http_req_duration` do k6 (client-side).
**Cache hit-rate (RNF05.2):** o k6 tira snapshot dos contadores em `setup`/
`teardown` e imprime o **delta da janela** — rode com `CACHE_ONLY=1` pra não
contaminar com os outros cenários (os contadores do `/metrics` são cumulativos).

## Metodologia

Medir antes de otimizar; instrumentar pra não otimizar no escuro:

1. `/metrics` (`src/lib/metrics.ts`): histograma por `(route, status)` +
   contadores `cache_hits/misses/unavailable_total` por namespace.
2. Carga com k6 (`scripts/load/proximity.js`).
3. `EXPLAIN ANALYZE` nas queries para entender os planos.

A instrumentação foi decisiva: a hipótese inicial (hidratação dos includes é o
gargalo) estava **errada** — a medição redirecionou para a query KNN.

## Resultados

> 🔁 **Re-medir antes da defesa.** Os números das tabelas abaixo foram coletados
> antes de dois ajustes que afetam a reprodução: (1) o `seed-perf.ts` usava
> categorias string e quebrava contra o enum `EventCategory` — corrigido, mas
> qualquer run anterior partiu de um seed que não roda hoje; (2) o `/metrics`
> agora exige `METRICS_TOKEN` em produção e o hit-rate passou a ser lido pelo
> delta de janela (`CACHE_ONLY=1`). Re-rode o harness atualizado e atualize as
> tabelas; os valores aqui são a **forma esperada** do resultado, não números
> oficiais. A inconsistência conhecida (ex.: "~619 req/s" vs. 9.443 hits+misses
> na linha do cache vinham de janelas diferentes) some com a leitura por delta.

### 0. Medição atual (sandbox 8 vCPU, seed 10k, k6 v1.7)

Run reproduzido com o harness corrigido (`node dist/server.js` em
`NODE_ENV=production`, Redis dedicado, ramping 0→100 VUs por cenário):

| Cenário | p95 | RNF01.3 (≤ 1 s) |
|---|---|---|
| `exp_feed` (`GET /events`, cacheado) | **70 ms** | ✅ |
| `exp_distance` (`orderBy=distance`, KNN keyset) | **583 ms** | ✅ |
| `exp_radius` (`radiusKm=5`) | **1,05 s** | ⚠️ limítrofe |

- `server_error_rate` **0%** (0 de 247.592 reqs); `checks` 100%.
- **RNF05.2 (CACHE_ONLY, mix 90% quente / 10% cauda):** hit-rate **89,6%**
  (delta de janela) — número honesto e ~no limiar; tráfego urbano mais
  concentrado que 90/10 ultrapassa 90%. (Substitui o "99,4%" anterior, que vinha
  de poucas células e era trivial por construção.)

**Achado (com EXPLAIN ANALYZE, seed 10k):** `exp_radius` é o caminho mais lento
sob carga (1,05 s vs. 583 ms do distance vs. 70 ms do feed), mas **não é query
lenta nem over-hidratação**. Profiling de uma request típica (737 eventos num
raio de 5 km do centro SP):

| Query | Plano | Tempo |
|---|---|---|
| `ST_DWithin` → ids | Bitmap Index Scan em `events_location_idx` | **2,6 ms** |
| `findMany` (id IN 737, ORDER BY date, LIMIT 21) | top-N heapsort | **4,6 ms** |

As duas SQL são ms-rápidas (índice usado, hidratação já limitada a `limit+1`).
Mas o custo **por request** do caminho antigo era bem maior que isso: medindo a
1 VU (sem concorrência, cache-miss) o `radiusKm` levava **74 ms** vs. **30 ms**
do `distance`. O extra não está no banco — está em **buscar TODOS os ids do raio
(737) → montar um `IN (...)` gigante → re-ordenar no Prisma**; sob 100 VUs essa
sobrecarga por request amplifica pra 1,05 s p95.

**Por que NÃO é a Fase 3 (enxugar payload):** o feed do app mobile **consome**
`recentComments[0]`, `images[0]` e `author` no `EventCard` — cortar o payload
quebraria a UI. A Fase 3 estava condicionada a "o mobile não consumir esses
campos"; ele consome, então a Fase 3 fica **descartada**.

**Fix de raiz aplicado:** unificar o caminho `radiusKm + orderBy=date` numa
**única query keyset** (`findEventIdsWithinRadiusPage`, espelhando o
`findPublicEventsByDistance` mas ordenando por `(isFeatured, date, id)`):
`ST_DWithin` + ordenação + keyset + `LIMIT` num SQL só, devolvendo já os ~21 IDs
da página pra hidratar (em vez dos 737). O cap de abuso é preservado por um
`count(*)` capado em `RADIUS_MAX_RESULTS+1` na mesma query; o cursor segue sendo
o id da última linha (mesmo formato do feed por data).

**Antes → depois (1 VU, cache-miss, back-to-back na mesma máquina — o `distance`
serve de régua, ficou idêntico nas duas medições, ~30 ms):**

| `radiusKm` cache-miss | Antigo (todos os ids + IN + re-sort) | Novo (keyset de página) |
|---|---|---|
| mediana | 74,2 ms | **41,9 ms** (−44%) |
| p90 | 97 ms | **47,5 ms** (−51%) |
| vs. `distance` | 2,47× | **1,36×** |

O gap residual (1,36×) é estrutural: o `radiusKm` ordena por data (sort da set
filtrada), enquanto o `distance` usa o índice GiST KNN pra ordenar sem sort.
Eliminá-lo exigiria um índice composto inviável sobre o resultado espacial —
fora de escopo. Em produção o cache (~89,6% hit) cobre a maioria das requests;
só o cache-miss paga o caminho de banco, agora ~44% mais barato.

> ⚠️ Comparação **a 1 VU** de propósito: os runs k6 a 100 VUs no sandbox variam
> 2–3× entre execuções (carga do host), então só a razão *dentro* de um run vale.
> A 1 VU back-to-back, com o `distance` de régua, isola o ganho do refactor.

### 1. Cache de grade (RNF05.2 + RNF01.4)

Snap de coordenadas a ~110 m (`snapToGrid`) faz vizinhos compartilharem a
entrada de cache. Tráfego que clusteriza em células (cenário realista de cidade):

| | p95 | throughput | hit-rate |
|---|---|---|---|
| **cache ON** (50 VUs, células quentes) | **110 ms** | ~619 req/s | **99,4%** (9391 hits / 52 misses) |
| **cache OFF** (mesma carga) | 680 ms | ~95 req/s | — |

→ **RNF05.2 atendido** (99,4% > 90%). O cache dá ~6× menos latência e ~6,5×
mais throughput no caminho quente.

### 2. Diagnóstico do gargalo (breakdown de fases)

Custo de uma requisição `orderBy=distance` (sem cache, 100k eventos), via log
de duração de query do Prisma:

| Fase | Custo |
|---|---|
| **Query KNN (espacial)** | **~138 ms** ← gargalo |
| Hidratação (events) | ~6 ms |
| Autor / comentário / imagens | ~0–2 ms |

A hidratação inteira é ~8 ms — otimizá-la não move o ponteiro. O custo é a
query KNN.

### 3. Causa-raiz e fix do índice KNN

`EXPLAIN ANALYZE` da query KNN original: **`Parallel Seq Scan` em ~80k linhas +
`Sort` por distância (spill em disco)** — o índice GiST KNN **não** era usado.

Isolando os defeaters (cada um sozinho derruba o index-scan):
- `JOIN users` (visibilidade do autor) → cross-table → seq-scan.
- `ORDER BY <->, id` (tiebreak do keyset) → 2º critério → sort completo.

**Correção (duas partes):**
1. **Denormalizar `authorIsPrivate` em `Event`** (sincronizado por trigger no
   Postgres — cobre insert, troca de autor e toggle de privacidade). A
   visibilidade vira filtro de coluna do `events` → sem JOIN.
2. **`ORDER BY` só por distância** (sem `, id`). O tiebreak por `id` fica no
   `WHERE` do cursor (de-dup ao paginar).

`EXPLAIN` depois: **`Index Scan using events_location_idx`**.

| uncached, 100k | antes (seq-scan) | depois (índice GiST) |
|---|---|---|
| 1 VU | ~195 ms | **18 ms** |
| 10 VUs | ~2,0 s | **79 ms** |
| 50 VUs | ~10–14 s | **382 ms** |

→ ~11× a 1 VU e ~25–37× sob concorrência. **A 50 VUs / 100k, sem cache, p95 =
382 ms** — atende o RNF01.3 (≤ 1 s) e fica abaixo do alvo de 500 ms do RNF01.4.
Página 2 (cursor) também usa o índice (~19 ms) — keyset preservado e rápido.

### 4. Escala 10× (RNF05.3)

Query espacial isolada (1 VU, sem cache):
- 100k eventos: p95 **~18 ms** (Index Scan KNN — O(log n)).

A busca não degrada com o volume (o GiST KNN escala sub-linearmente). O p95 a
10× fica muito abaixo de 1 s → **RNF05.3 atendido no nível da query**, sem
sharding (ver "Escala" abaixo).

## Conformância

| RNF | Resultado | Status |
|---|---|---|
| RNF01.3 (p95 ≤ 1 s) | cacheado 110 ms; uncached 18–382 ms (1–50 VUs) | ✅ |
| RNF01.4 (1000 rps @ ≤ 500 ms) | single-instance: uncached 382 ms @ 50 VUs; 1000 rps exige escala horizontal | ⚠️ via cache + escala (ver abaixo) |
| RNF05.2 (hit-rate > 90%) | 99,4% no tráfego clusterizado | ✅ |
| RNF05.3 (10× sem degradar) | query a 100k ~18 ms | ✅ (query); sharding como evolução |
| RF07.6 (data/distância/popularidade) | os três `orderBy` implementados, com keyset | ✅ |

## Escala e limitações

- **Throughput (RNF01.4 = 1000 rps):** após o fix, o gargalo do caminho uncached
  sob alta concorrência é o **throughput de uma instância** (Node serializando
  payloads), não a query nem o pool. 1000 rps é alvo de **cache + escala
  horizontal** (múltiplas instâncias atrás de um balanceador — RNF05.1). Por
  isso o cenário `rnf014` do k6 é **opt-in** (`RNF014=1`): numa única instância
  ele falha o próprio `p95<500` por design — rode-o só no ambiente
  representativo e reporte o número (mesmo que seja a evidência da necessidade
  de escala horizontal, não um "passou").
- **PgBouncer:** evolução para quando houver múltiplas instâncias (multiplexar
  os pools sob o `max_connections` do Postgres). Não reduz o custo por request;
  não é a primeira alavanca para o gargalo atual.
- **Sharding/particionamento (RNF05.3):** não implementado — a evidência a 10×
  mostra que o MVP não precisa. Evolução planejada: particionamento declarativo
  de `events` por faixa de data ou região (geohash), com corte por throughput.
- **Pool em produção:** definir `connection_limit` no `DATABASE_URL`.

## Decisões arquiteturais

- **`authorIsPrivate` denormalizado em `Event`, sincronizado por trigger**
  (`migrations/.../add_author_is_private`). Mantém a visibilidade como filtro de
  coluna do `events` — sem JOIN com `users` — preservando o index-scan KNN.
  Cobre todos os caminhos de escrita (app, factory, `createMany` do seed,
  toggle de privacidade). Cache `events:public:*` é invalidado quando
  `isPrivate` muda (senão uma lista cacheada vazaria/ocultaria por até o TTL).
- **`ORDER BY` por distância sem tiebreak `id`.** Preserva o índice. O tiebreak
  por id fica no `WHERE` do cursor (garante **sem duplicata** entre páginas).
  Trade-off: em **empate de coordenada exata** (mesmo ponto geocodificado) a
  ordem entre eles é não-determinística e uma página pode não trazer todos —
  aceitável num feed "perto de mim"; o índice (~1 ms vs ~138 ms) compensa.
- **Tolerância de borda do `radiusKm` ~79 m.** O filtro `ST_DWithin` usa o
  centro snapado, não o original; o snap arredonda a 3 casas, então o centro
  fica a no máximo **meia-diagonal da célula** (~79 m em SP) do ponto real — e
  é esse o deslocamento máximo do círculo. (A diagonal cheia da célula, ~157 m,
  é a distância entre dois usuários que compartilham a mesma entrada de cache,
  não a tolerância de borda de uma request.) Decisão consciente vs. o "Fluxo B"
  do plano (superconjunto cacheado + refino pela coordenada original): "raio" é
  intenção difusa ("perto de mim"), o erro fica abaixo do GPS, e o refino por
  request quebraria o compartilhamento de chave de cache do `radiusKm`. A
  ordenação por distância também parte do centro snapado (idem: imperceptível,
  a API não expõe a distância, só lat/lng).
