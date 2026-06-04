import type { FastifyInstance } from 'fastify'

/**
 * Métricas in-process expostas em /metrics no formato Prometheus text.
 *
 * Existe pra dar evidência empírica dos RNFs de performance:
 * - histograma de duração por (route, status) → corrobora p95 (RNF01.3/01.4)
 *   server-side (a fonte de verdade da latência é o k6, client-side).
 * - contadores de cache por namespace → mede hit-rate (RNF05.2). Só conta
 *   hit/miss quando o Redis está ativo; sem Redis vira `cache_unavailable`
 *   (senão o ratio seria inválido num ambiente sem cache).
 *
 * Estado é global ao processo; em teste use `resetMetrics()` e compare deltas.
 */

const DURATION_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]

type HistogramEntry = {
  buckets: number[]
  inf: number
  sum: number
  count: number
}

const httpHist = new Map<string, HistogramEntry>()
const cacheHits = new Map<string, number>()
const cacheMisses = new Map<string, number>()
const cacheUnavailable = new Map<string, number>()

function bump(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1)
}

export function recordHttp(route: string, status: number, durationMs: number) {
  const key = `${route} ${status}`
  let entry = httpHist.get(key)
  if (!entry) {
    entry = {
      buckets: new Array(DURATION_BUCKETS_MS.length).fill(0),
      inf: 0,
      sum: 0,
      count: 0,
    }
    httpHist.set(key, entry)
  }
  entry.count += 1
  entry.sum += durationMs
  const idx = DURATION_BUCKETS_MS.findIndex((b) => durationMs <= b)
  if (idx === -1) entry.inf += 1
  else entry.buckets[idx] += 1
}

/**
 * Namespace do cache a partir da chave (`v1:events:public:...` → `events:public`).
 * Agrupa o ratio por área lógica sem explodir cardinalidade com as partes
 * variáveis (viewerId, coords, cursor).
 */
function cacheNamespace(key: string): string {
  const withoutVersion = key.replace(/^v\d+:/, '')
  const parts = withoutVersion.split(':')
  return parts.slice(0, 2).join(':') || withoutVersion
}

export function recordCacheHit(key: string) {
  bump(cacheHits, cacheNamespace(key))
}

export function recordCacheMiss(key: string) {
  bump(cacheMisses, cacheNamespace(key))
}

export function recordCacheUnavailable(key: string) {
  bump(cacheUnavailable, cacheNamespace(key))
}

export function resetMetrics() {
  httpHist.clear()
  cacheHits.clear()
  cacheMisses.clear()
  cacheUnavailable.clear()
}

function escapeLabel(value: string): string {
  // Prometheus text format exige escape de \, " e \n nos values de label.
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
}

export function renderMetrics(): string {
  const lines: string[] = []

  lines.push('# HELP http_request_duration_ms Duração das respostas HTTP (ms)')
  lines.push('# TYPE http_request_duration_ms histogram')
  for (const [key, entry] of httpHist) {
    const [route, status] = key.split(' ')
    const labels = `route="${escapeLabel(route)}",status="${status}"`
    let cumulative = 0
    for (let i = 0; i < DURATION_BUCKETS_MS.length; i++) {
      cumulative += entry.buckets[i]
      lines.push(
        `http_request_duration_ms_bucket{${labels},le="${DURATION_BUCKETS_MS[i]}"} ${cumulative}`,
      )
    }
    cumulative += entry.inf
    lines.push(
      `http_request_duration_ms_bucket{${labels},le="+Inf"} ${cumulative}`,
    )
    lines.push(`http_request_duration_ms_sum{${labels}} ${entry.sum}`)
    lines.push(`http_request_duration_ms_count{${labels}} ${entry.count}`)
  }

  const counters: [string, Map<string, number>][] = [
    ['cache_hits_total', cacheHits],
    ['cache_misses_total', cacheMisses],
    ['cache_unavailable_total', cacheUnavailable],
  ]
  for (const [name, map] of counters) {
    lines.push(`# TYPE ${name} counter`)
    for (const [namespace, value] of map) {
      lines.push(`${name}{namespace="${escapeLabel(namespace)}"} ${value}`)
    }
  }

  return `${lines.join('\n')}\n`
}

/**
 * Registra o hook de duração (onResponse) e a rota GET /metrics (sem auth —
 * exposição interna). Chamado por server.ts e test/app.ts ANTES das rotas pra
 * o hook capturar todas as respostas.
 */
export function registerMetrics(app: FastifyInstance) {
  app.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions?.url ?? 'unmatched'
    recordHttp(route, reply.statusCode, reply.elapsedTime)
  })

  app.get('/metrics', async (_request, reply) => {
    reply.header('content-type', 'text/plain; version=0.0.4')
    return renderMetrics()
  })
}
