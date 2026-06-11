# Plano de Implementação — Hardening da Busca por Proximidade (v2)

> v2 corrige o furo central da v1: o plano anterior **adiava a alavanca decisiva
> de latência** (cache de proximidade) e ainda assim prometia RNF01.4. Esta versão
> reordena para **medir antes de otimizar**, promove o cache de grade a núcleo, e
> fecha RNF05.3 com evidência empírica em vez de "fora de escopo".

## Context

Auditoria do caminho de `orderBy=distance` (`events.service.ts:47` →
`events.repository.ts:136` → `spatial.ts:78`) revelou que cada request faz **3
round-trips ao Postgres, todos sem cache**:

1. **KNN com overfetch 20×** (`findEventIdsByDistance`, spatial.ts:78) — para `limit=20`
   busca até **400 IDs** (cap 1000), ordenados por distância.
2. **`findMany IN (...)`** sobre esses IDs com `buildSharedIncludes` pesado por evento
   (autor + 3 `_count` + 2 comentários *com* autor e contagem + imagens,
   events.repository.ts:40-56), reordena em JS e **fatia para 20** — ~95% do trabalho
   de include é descartado.
3. **`findViewerStatesForEvents`** — +2-3 queries se autenticado.

`events.service.ts:47` faz **bypass total de cache** em `orderBy=distance`. Isso
contradiz os RNFs que a entrega quer defender:

- **RNF01.4** ("1000 req/s … tempo de resposta de até 500ms … taxa de erro até 0.1%
  para 95% das requisições"): inviável com 3 round-trips Postgres não-cacheados por request.
- **RNF05.2** ("cache … taxa de acerto maior que 90%"): a própria v1 admite hit-rate ~0
  na proximidade.

A infraestrutura base **já existe e funciona**: PostGIS instalado, coluna `location`
como `geography(Point,4326) GENERATED ALWAYS AS STORED`, índice GiST `events_location_idx`,
cache Redis 60s nas listagens não-distância. O objetivo desta entrega é **reduzir o p95
(ms) da proximidade com evidência antes→depois**, atendendo RNF01.3, RNF01.4, RNF05.2 e
RNF05.3, e cumprindo RF07.6 — mensurável e defensável na banca.

RNFs alvo (texto literal do `Documentacao Conectai TCC I.md`):
- **RNF01.3**: buscas da API retornam em até 1s, p95.
- **RNF01.4**: 1000 req/s, p95 ≤ 500ms, erro ≤ 0.1%.
- **RNF05.2**: cache com taxa de acerto > 90%.
- **RNF05.3**: BD suporta 10× volume "sem degradar a performance das buscas (RNF01.3)".
- **RF07.6**: ordenar por data, distância, **popularidade** (backlog) — sustenta o objetivo
  específico (e) "geolocalização em tempo real para recomendação de eventos por proximidade".

Branch: `feat/proximidade-hardening` (worktree a partir de `main`).

## Decisões já fechadas (via diálogo de design)

| Decisão | Escolha | Justificativa |
|---|---|---|
| Cache de proximidade | **Snap lat/lng a grade ~110m + bucket de `radiusKm`** | Lat/lng contínuos tornam o hit-rate ~0; arredondar a uma célula faz usuários próximos compartilharem a mesma entrada → hit-rate >90% e throughput. Ordenação vira "por célula", imperceptível no feed. |
| Pagination em `orderBy=distance` | **Cursor opaco `(dist, eventId)`** em base64url JSON, onde `dist` é o valor de `location <-> point` | Keyset > offset em KNN (sem recálculo O(n) por página); estável quando vários eventos têm distância idêntica. |
| Cap em `findEventIdsWithinRadius` | **1000 IDs, throw 400 se exceder** | Diferencia "vazio" (200 []) de "abuso" (400); protege o backend de `IN (...)` gigante. |
| Enxugar payload da lista | **Condicionado à medição** | Só corta os 2 comentários + includes aninhados se o Bloco B mostrar que dominam a latência por evento. |
| RNF05.3 (10×) | **Medir empiricamente** | Seed ~100k eventos e mostrar p95 ≤ 1s no mesmo k6, sem sharding real (fora do escopo de monolito). |

## Achados da auditoria (estado base)

✅ PostGIS via `prisma/migrations/20260510183000_event_lifecycle_postgis/migration.sql`;
   `location` é `geography(Point,4326)` gerada; índice GiST `events_location_idx` (usado
   por `&&`, `ST_DWithin`, KNN `<->`).
✅ `src/lib/spatial.ts` tem 3 helpers — `findEventIdsInBbox`, `findEventIdsWithinRadius`,
   `findEventIdsByDistance`.
✅ `events.repository.ts:findPublicEvents` integra os helpers via `IN (...)`.
✅ Cache Redis 60s em `events.service.ts:listEvents` para listagens não-distância;
   **bypass** em `orderBy=distance`; invalidação por `events:public:*` em create/update/delete.

### Gaps vs RNFs

| Gap | Onde | RNF | Severidade |
|---|---|---|---|
| Proximidade sem cache (bypass) | `events.service.ts:47` | RNF01.4, RNF05.2 | **Crítica** |
| `findEventIdsWithinRadius` sem `LIMIT` | `spatial.ts:57` | RNF01.3 | Alta |
| Overfetch 20× em `orderBy=distance` | `events.repository.ts:131` | RNF01.3 | Alta |
| `orderBy=distance` desabilita cursor | `events.schema.ts:106` + `events.service.ts:54` | RF07.6, RNF01.3 | Média |
| Sem `orderBy=popularity` | `events.schema.ts:86` | RF07.6 | Média |
| Sem evidência empírica / teste de carga | — | RNF01.3, RNF01.4, RNF05.3 | Alta (defesa) |

---

## Fase 0 — Baseline mensurável (medir antes de otimizar)

**`src/lib/metrics.ts` (novo):**
1. Histograma in-process por `(route, status)` no hook `onResponse`.
2. **Contadores de cache** `cache_hits_total` / `cache_misses_total` / `cache_unavailable_total`
   por `namespace`, com `cache_hit_ratio` derivado — instrumentados dentro de `cache.get`
   (`src/lib/cache.ts`). **O label `namespace` distingue os dois fluxos:** `events:public`
   (Fluxo A, resposta final) e `events:public:radius-superset` (Fluxo B, superconjunto). A
   RNF05.2 é reportada **por fluxo** (cada um > 90% no seu cenário) **e** num agregado por
   prefixo `events:public*` — senão o cenário de raio (Fluxo B) ficaria fora da métrica. **Só conta hit/miss quando o Redis está ativo**
   (hit = retornou valor, miss = retornou `null` com Redis vivo); `redis === null`
   (redis.ts:4) incrementa `cache_unavailable_total` e **fica fora do ratio** — senão o
   hit-rate seria inválido em ambiente sem Redis.

Endpoint `GET /metrics` em formato Prometheus text exposition (sem auth — exposição
interna). Registrar em `src/server.ts` e `src/test/app.ts`. **Sem os contadores de cache a
RNF05.2 (hit-rate > 90%) não é auditável — o histograma HTTP sozinho não distingue hit de miss.**

**`scripts/load/seed-perf.ts` (novo):** popula DB separado (`conectai_perf`) com volume
**parametrizável** — ~10k (baseline) e ~100k (teste 10× da Fase 5) — distribuídos em grade
espacial cobrindo SP+RJ+BH.

**`scripts/load/proximity.js` (novo, k6):** dois grupos de cenários —
- **Exploratórios (`ramping-vus`, 0→100 VUs, 30s sobe / 60s sustenta):** (a) `GET /events`,
  (b) `?radiusKm=5`, (c) `?orderBy=distance`, (d) **cache** repetindo as MESMAS coordenadas
  de poucas células (mede hit-rate). Mapeiam a curva latência×carga e acham gargalo.
  **RNF01.3 com threshold POR cenário** (`http_req_duration{scenario:exp_a}: ['p(95)<1000']`,
  idem `exp_b`, `exp_c`) — p95 agregado esconderia um endpoint lento atrás dos rápidos.
- **RNF01.4 (`constant-arrival-rate`):** cenário `rnf014` fixando **1000 req/s** — VU não
  garante RPS, só o executor de chegada constante garante. Thresholds que **falham o teste**
  se a RNF não bater: `http_req_duration{scenario:rnf014}: ['p(95)<500']` e
  **`server_error_rate{scenario:rnf014}: ['rate<0.001']`** — métrica custom (ver nota "4xx não
  é falha"), **não** `http_req_failed` (que conta qualquer não-2xx).

**Notas de medição (pra os números não serem contestáveis na banca):**
- **4xx não é falha — e `check()` não muda `http_req_failed`.** O cap de raio (A1) e cursor
  inválido retornam **400** (correto), mas o k6 conta qualquer não-2xx em `http_req_failed`, e
  um `check()` custom **não** altera essa métrica. O orçamento de 0.1% (RNF01.4) é medido por
  uma métrica custom **`server_error_rate`** (`Rate`) incrementada só quando `res.status >= 500`,
  com threshold próprio. Alternativa: `http.setResponseCallback(http.expectedStatuses(...))`
  pra tirar os 4xx esperados do `http_req_failed`. O `rnf014` ainda usa só params válidos.
- **Fonte de verdade por RNF.** Latência (RNF01.3/01.4) = `http_req_duration` do k6
  (client-side, inclui rede = "tempo de resposta da API"). `/metrics` (in-process) serve pro
  `cache_hit_ratio` e corroboração — não misturar as duas fontes na defesa.
- **`viewerId` na chave derruba o hit-rate agregado.** Cada usuário autenticado tem entradas
  próprias; medir o ratio sobre todo o tráfego afunda abaixo de 90%. A RNF05.2 é medida/
  reportada **no segmento anônimo/público** (chave `anon`, que domina o feed) — ou segmentada
  anon vs. autenticado no doc.
- **`cache_hit_ratio` por janela, não acumulado.** Os contadores são cumulativos; ler o ratio
  depois de baseline + warmup + outros cenários o contamina. Tirar **snapshot dos contadores
  no início e no fim da janela do cenário de cache** e reportar o **delta** (Δhits/Δmisses) —
  ou rodar o cenário de cache isolado com reset prévio.
- **Mix declarado do cenário `rnf014`.** 1000 rps de quê? Declarar explícito no doc. Padrão:
  **mix realista de feed** — ~70% `GET /events` (cacheado), ~20% `?radiusKm` (cacheado), ~10%
  `?orderBy=distance`. Rodar **também** um `rnf014-distance` (100% `orderBy=distance`) como
  pior-caso, para a banca ver os dois números (típico e adversarial).
- **Distribuição realista de coordenadas.** O cenário de cache/1000 rps não pode usar 1 célula
  só (hit-rate ~100% trivial e "gamed"). Usar um conjunto de poucas células quentes + cauda
  longa, refletindo tráfego real de cidade.
- **Perf env precisa de Redis.** `redis` é `null` sem `REDIS_URL` (redis.ts:4) → cache vira
  no-op. O ambiente de carga (`conectai_perf`) precisa de `REDIS_URL` próprio; testes já têm
  (`.env.test`, db 15).

**Saída:** tabela baseline p50/p95/p99/erro/throughput por rota — a coluna "antes" do doc.
Mede também o peso real dos includes, decidindo a Fase 3.

## Fase 1 — Estrutural single-request

### A1. Cap em `findEventIdsWithinRadius` — `src/lib/spatial.ts`
- **O cap conta sobre o resultado FILTRADO, não o raio bruto** (mesma raiz do A2). A função
  recebe e aplica `category`, `dateFrom`, `dateTo`, `status`/lifecycle e `viewerId` no `WHERE`
  da SQL espacial **antes** do `LIMIT` — senão `radius=1001 brutos` mas `category=music → 30`
  retornaria 400 errado.
- Exportar `RADIUS_MAX_RESULTS = 1000`; adicionar `LIMIT ${RADIUS_MAX_RESULTS + 1}` (após os
  filtros).
- Se `rows.length > RADIUS_MAX_RESULTS` → `throw { statusCode: 400, message: 'Raio muito
  amplo: mais de 1000 eventos correspondem. Refine os filtros (categoria, data ou raio menor).' }`.

### A2. Keyset KNN para `orderBy=distance` — `src/lib/spatial.ts`
- **Filtros secundários vão PRA DENTRO da SQL espacial (raiz, não remendo).** A função recebe
  `category`, `dateFrom`, `dateTo`, `status`/lifecycle e `viewerId` e os aplica no `WHERE`
  junto do `visibilityPredicate`. Assim o KNN devolve exatamente `limit (+1)` IDs **já
  filtrados** — elimina o bug de "página incompleta" quando os mais próximos são descartados
  por um filtro aplicado depois no Prisma. Dispensa o overfetch 20× da v1 (que era justamente
  o remendo que o CLAUDE.md condena: "filtro na camada errada").
- **Uma única expressão de distância, canônica.** Usar `e.location <-> point` no SELECT, no
  keyset (`WHERE`) e no `ORDER BY` — a MESMA expressão nos três. `<->` em geography retorna
  metros e é o que ativa o índice GiST KNN; `ST_Distance` num `ORDER BY` **não** usa o índice
  e pode divergir do `<->` em quase-empates. O cursor guarda o valor de `<->`.
- `findEventIdsByDistanceKeyset({ center, limit, radiusKm?, after?, category?, dateFrom?,
  dateTo?, status?, viewerId? })` → `{ id, dist }[]`. SQL:
  `SELECT e.id, e.location <-> point AS dist … WHERE <todos os filtros> AND (e.location <->
  point > $afterDist OR (e.location <-> point = $afterDist AND e.id > $afterId)) ORDER BY
  e.location <-> point, e.id ASC LIMIT $limit + 1`.
- Tipos `DistanceCursor = { dist: number; id: string }` e `EventDistanceRow = { id; dist }`.
- Helpers `encodeDistanceCursor`/`decodeDistanceCursor` (base64url JSON). Remove
  `findEventIdsByDistance` (caller único migra).

**Lifecycle em SQL — centralizar e testar paridade (risco de drift).** A regra de lifecycle
não é trivial (`event-filters.ts:8-86`: 5 status, `SOON_THRESHOLD_MS`, `DEFAULT_DURATION_MS`,
`endDate` vs `date`+duração, cancelados). Levá-la pra SQL **não pode ser reescrita à mão e
divergir** do `buildLifecycleWhere` do Prisma. Plano:
- Novo `lifecycleSqlPredicate({ includePast, status, now })` em `spatial.ts` (ou helper
  compartilhado) que **reusa os mesmos boundaries** (`now`, `soonBoundary`, `pastBoundary`
  derivados das constantes já exportadas em `event-lifecycle.ts`) e emite `Prisma.sql`
  equivalente a `statusConditionFor`/`buildLifecycleWhere`.
- **Teste de paridade obrigatório:** mesmo dataset, comparar os IDs do `buildLifecycleWhere`
  (Prisma) vs. o predicado SQL para **cada um dos 5 status** + `includePast` true/false. Tem
  que bater 100%.

**`events.repository.ts`:** `findPublicEventsByDistance(filters, limit, cursor)` →
`{ events, nextCursor }`. Decoda cursor (inválido → 400), chama o keyset **com todos os
filtros**, `findMany` com `id IN` **apenas para hidratar os includes** (sem re-filtrar — o
KNN já garantiu o conjunto), reordena pela ordem do KNN. `hasMore = rows.length > limit`,
corta pro `limit`, `nextCursor` = encode do último row mantido. Remove o branch
`orderBy === 'distance'` de `findPublicEvents`.

**`events.schema.ts`:** `cursor` de `.uuid()` → `.string().min(1).max(256)`; remover o
refine que bloqueia `orderBy=distance + cursor` (linhas 106-109); manter os demais.

**`events.service.ts`:** branch `orderBy=distance` chama `findPublicEventsByDistance` e usa
o `nextCursor` real (não `null`).

**Índices/pool (suporte RNF01.4):**
- **Estado atual do `Event` (schema.prisma:122-124):** `@@index([date])`,
  `@@index([isPublic, date])`, `@@index([isFeatured, date, id])` + GiST `events_location_idx`.
  **Não existe índice em `category`.**
- No caminho **KNN** (`orderBy=distance`) os filtros agora estão na SQL espacial (A2), mas o
  `ORDER BY e.location <-> point` é dirigido pelo GiST KNN — um btree de `category` **não
  acelera** essa varredura (vira filtro residual sobre o índice espacial, inerente a
  KNN-com-predicado).
- O índice de `category` importa mesmo é no **feed por data/raio em cache-miss** (filtro
  `category IN` sobre conjunto grande). **Derivar o índice composto do `EXPLAIN ANALYZE` real**
  (candidato:
  `@@index([isPublic, category, date])`, casando filtro + ordenação `(isFeatured, date, id)`)
  em vez de adicionar às cegas — coerente com "atacar a raiz" do CLAUDE.md.
- Validar uso do GiST no KNN via `EXPLAIN ANALYZE`.
- Tunar `connection_limit`/`pool_timeout` no `DATABASE_URL` (pool default do Prisma sufoca
  sob 1000 req/s × round-trips). Medir o ganho Fase 0→1.

### A3. Testes de borda — `events.test.ts`
1. 1ª página + `nextCursor` populado (25 eventos, `limit=10`).
2. 2ª página via cursor → distâncias ≥ anterior, sem overlap.
3. Raio amplo demais (>1001 eventos) → 400 com mensagem prescrita.
4. Cursor inválido (`'lixo'`) → 400.
5. Empate de distância (lat/lng idênticos) → ordem estável por id.

→ **Re-medir.** Mostra o ganho do keyset (400→20 rows) isolado.

## Fase 2 — Cache de grade na proximidade (núcleo)

**`src/lib/spatial.ts` (ou `cache.ts`):**
- `snapToGrid(lat, lng, decimals = 3)` → arredonda a ~110m.
- `snapRadiusKm(km)` → sobe ao degrau de uma escada fixa (`[1,2,5,10,25,50,100,500]`).

**Princípio único (resolve a ambiguidade de borda nos dois modos):** o snap afeta **somente a
ordenação e a chave de cache**; **todo filtro de inclusão (`ST_DWithin` por `radiusKm`) usa a
coordenada ORIGINAL.** Disso saem dois fluxos de cache distintos:

**`events.service.ts`:** remover o bypass. Decidir o fluxo pelo request:
- **Fluxo A — resposta final** (`orderBy=distance` **sem** `radiusKm`, e o feed por data):
  não há filtro de inclusão. `cacheKey` = `cache.key('events:public', viewerId ?? 'anon',
  …filtros…, orderBy, snappedLat, snappedLng, cursor)`; KNN keyset pagina no SQL com centro
  snapado; `cache.set(key, páginaFinal, 60)`. **O cache guarda a resposta final.**
- **Fluxo B — superconjunto** (qualquer request **com** `radiusKm`, inclusive
  `orderBy=distance + radiusKm`): namespace separado **`events:public:radius-superset:*`**
  guarda o **conjunto candidato** (centro snapado + raio expandido = `snappedRadius + margem
  da célula`), ordenado por `<->` do centro snapado. **A resposta final NÃO
  está no cache** — é derivada **por request**: refino por `radiusKm` exato sobre a coordenada
  ORIGINAL (cada `SharedEvent` traz `latitude/longitude` → ST_Distance/haversine em memória) →
  ordena (distância do centro snapado se `orderBy=distance`, senão data) → pagina em memória.
  Refinar o conjunto inteiro **antes** de paginar evita página incompleta. `radius-superset`
  cai sob `events:public:*`, então o `cache.invalidate('events:public:*')` de create/update/
  delete já cobre.

**Cap de abuso (A1) é avaliado sobre o conjunto REFINADO, nunca sobre o superconjunto.** O raio
expandido pode ter > 1000 candidatos que, após o refino pelo raio exato (coordenada original),
caem para menos — aplicar o 400 antes do refino daria "raio amplo demais" falso. Regra: o
`RADIUS_MAX_RESULTS = 1000 → 400` conta sobre o resultado refinado. O superconjunto usa um
**teto técnico próprio e maior** (ex. ~5000) só pra proteger o backend e garantir que contém
todos os eventos do raio exato; se o superconjunto estourar esse teto, aí sim é abuso real
(raio gigante) e o 400 é legítimo.

**Por que é correto, por modo:**
- **`orderBy=distance` sem `radiusKm`:** sem inclusão → o snap só reordena dentro da célula (a
  API não expõe distância, só `latitude/longitude`) → imperceptível. Cursor `(dist, id)`
  relativo ao centro snapado → páginas consistentes (Fluxo A).
- **Qualquer modo com `radiusKm`** (inclui `orderBy=distance + radiusKm`): o centro snapado
  deslocaria o `ST_DWithin` em ~156m e mudaria **quem entra no raio** — por isso a inclusão usa
  a coordenada original (Fluxo B). Alternativa mais leve, se o superconjunto não compensar:
  **tolerância de borda explícita (≤ ~156m) documentada** — defensável porque `radiusKm` já é
  intenção difusa ("perto de mim").

**Hit-rate:** tráfego anônimo/público (chave `anon`) domina e compartilha células →
RNF05.2 >90% atingível; viewers autenticados têm entradas próprias mas ainda acertam em
paginação/refresh.

**Testes:** coordenadas dentro da mesma célula → mesma chave/hit; invalidação ao criar evento
público; **borda do raio** — evento logo dentro/fora do `radiusKm` exato (medido da coordenada
original) é incluído/excluído corretamente apesar do centro snapado (valida o refino).

→ **Re-medir.** Salto de hit-rate + queda de p95/throughput sob carga (RNF01.4 + RNF05.2).
**Evidência principal do "ms menor".**

## Fase 3 — Enxugar payload da lista (condicional)

**Só se a Fase 0 mostrar que `buildSharedIncludes` domina a latência por evento.** Lista
devolve só contadores (`_count`); os 2 comentários recentes + autor + reações ficam **apenas
em `GET /events/:id`** (`findEventById`). Exige confirmar que o app mobile não consome
`recentComments` no feed antes de cortar. Cria um include enxuto para a lista, mantendo
`buildSharedIncludes` no detalhe.

## Fase 4 — `orderBy=popularity` + score híbrido (RF07.6 + obj. (e))

**`events.schema.ts`:** `orderBy: z.enum(['date','distance','popularity'])`; cursor opaco
`{ score, id }` (separar `PopularityCursor`).
**`events.repository.ts`:** `findPublicEventsByPopularity(filters, limit, cursor)` reusando
a fórmula do heatmap (`confirmed*2 + interested*1`, já em `findEventsForMap`,
events.repository.ts:423) com keyset `(score, id)`.
**`events.service.ts`:** rota a branch quando `orderBy=popularity`.
**Opcional (`nearby-popular`):** `score / (1 + dist_km²)` — germe do "algoritmo de
recomendação multi-dimensional" (obj. (e)), SQL único combinando `ST_Distance` + agregação
de attendances. Latência-neutro; narrativa de feature, não de ms.
**Testes:** ordenação correta + paginação keyset estável.

## Fase 5 — Evidência de RNF05.3 (10×)

Re-rodar o k6 da Fase 0 contra o seed de **100k** eventos; mostrar que p95 **continua ≤ 1s**
(RNF01.3 preservado).

**Literalidade do RNF05.3 ("via sharding ou particionamento", DocumentacaoConectaiTCC.md:999):**
a evidência a 10× cobre o *resultado* exigido ("sem degradar a performance das buscas"), mas
o texto cita o *meio*. Para não depender só do número na banca, documentar em
`docs/perf-proximidade.md` uma **decisão arquitetural explícita**: PostGIS GiST + índices
compostos atendem o MVP a 10× (provado), e o **particionamento fica como evolução planejada
e justificada** — particionamento declarativo de `events` por faixa de data
(`PARTITION BY RANGE (date)`) ou por região (prefixo geohash), com ponto de corte definido
pelo throughput observado. Assim a banca tem a resposta literal (particionamento planejado)
+ o número que mostra que o MVP ainda não precisa dele.

## Fase 6 — Doc com resultados

**`docs/perf-proximidade.md` (novo):** tabela antes→depois por fase (p50/p95/p99/erro/
throughput/`cache_hit_ratio`) por endpoint; setup reproduzível (seed, invocação k6, leitura
de `/metrics`, comparação de outputs); análise: gargalo identificado, ganho de cada fase,
conformidade com RNF01.3, RNF01.4 (cenário `rnf014`), RNF05.2 (hit-ratio) e RNF05.3
(número a 10× **+ decisão arquitetural de particionamento planejado**, ver Fase 5).

---

## Critérios de aceitação

- [ ] `pnpm build` + `pnpm lint` limpos; `pnpm test` verde (suíte + novos testes).
- [ ] Testes do keyset: 1ª página, página via cursor sem overlap, raio amplo→400, cursor
      inválido→400, empate→ordem estável por id.
- [ ] Teste de cache de grade: mesma célula → mesma chave/hit; invalidação ao criar evento;
      **borda do raio** correta (refino pela coordenada original).
- [ ] **Paridade lifecycle SQL × Prisma** (`buildLifecycleWhere`): mesmos IDs para os 5 status
      + `includePast` true/false.
- [ ] k6 exploratórios: p95 ≤ 1000ms **por cenário/endpoint** (não agregado) (RNF01.3).
- [ ] k6 cenário `rnf014` (`constant-arrival-rate` @ 1000 req/s): thresholds
      `http_req_duration{scenario:rnf014} p(95)<500` e
      `server_error_rate{scenario:rnf014} rate<0.001` **passam** (RNF01.4).
- [ ] `cache_hit_ratio` > 0.90 no cenário de cache, **por fluxo** (`events:public` e
      `events:public:radius-superset`) e no agregado por prefixo `events:public*`, lido de
      `/metrics` (RNF05.2).
- [ ] k6 a 100k eventos com p95 ≤ 1s (RNF05.3).
- [ ] `docs/perf-proximidade.md` com tabela antes→depois mensurável.

## Arquivos críticos

**Modificados:** `src/lib/spatial.ts` (A1, A2, snap), `src/lib/cache.ts` (instrumentação
hit/miss + snap helpers, opc.),
`src/modules/events/events.repository.ts` (keyset, popularity, include enxuto opc.),
`src/modules/events/events.schema.ts` (cursor, orderBy), `src/modules/events/events.service.ts`
(branch distance/popularity, cache de grade), `src/modules/events/events.test.ts`,
`src/server.ts` + `src/test/app.ts` (/metrics), `DATABASE_URL` (pool).

**Novos:** `src/lib/metrics.ts`, `scripts/load/seed-perf.ts`, `scripts/load/proximity.js`,
`docs/perf-proximidade.md`.

## Estratégia de commit / PR

Commits por fase: `test:` (baseline + metrics + k6) → `fix:` (cap + keyset + pool/índices)
→ `feat:` (cache de grade) → `feat:` (popularity) → `docs:` (perf). **Sugestão:** dois PRs —
PR1 "proximidade — hardening de latência + evidência" (Fases 0,1,2,3,5,6) e PR2 "ordenação
por popularidade" (Fase 4). Se preferir a narrativa única da defesa, fica 1 PR só.

## Verificação end-to-end

```bash
pnpm db:generate && pnpm build && pnpm lint && pnpm test
# Carga (terminal 1):
pnpm dev
# Terminal 2:
pnpm exec tsx scripts/load/seed-perf.ts --events 10000   # baseline
k6 run scripts/load/proximity.js
curl http://localhost:3333/metrics | head -50            # confere histograma/hit-rate
# Teste 10× (RNF05.3):
pnpm exec tsx scripts/load/seed-perf.ts --events 100000
k6 run scripts/load/proximity.js
```

## Fora de escopo

- **Sharding/particionamento real** (RNF05.3): não implementado no MVP — coberto por (i)
  evidência empírica a 10× (Fase 5) e (ii) decisão arquitetural de particionamento planejado
  documentada em `docs/perf-proximidade.md`. Implementação fica como evolução.
- **Rate limit em `/events`** (RNF04.4): entra em PR de hardening genérico depois.
