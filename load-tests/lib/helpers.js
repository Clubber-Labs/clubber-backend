// Utilitários compartilhados dos cenários k6 (BASE_URL, bbox, login, summary).
import http from 'k6/http'
import { check } from 'k6'

// URL base da API sob teste. Default: servidor de dev local.
//   k6 run -e K6_BASE_URL=http://localhost:3333 load-tests/01-geo-baseline.js
export const BASE_URL = __ENV.K6_BASE_URL || 'http://localhost:3333'

// Diretório onde os summaries JSON são gravados (relativo ao CWD do k6).
const RESULTS_DIR = __ENV.RESULTS_DIR || 'results'

// Bounding box que cobre os eventos do seed (região de Curitiba: o seed gera
// lat -25.65..-25.35 / lng -49.45..-49.15). Folga nas bordas pra pegar todos.
export const BBOX = {
  bboxSouth: -25.7,
  bboxNorth: -25.3,
  bboxWest: -49.5,
  bboxEast: -49.1,
}

// Credenciais determinísticas criadas pelo `pnpm db:seed` (senha fixa senha123).
export const SEED_USER = {
  email: __ENV.K6_USER_EMAIL || 'premium@conectai.dev',
  password: __ENV.K6_USER_PASSWORD || 'senha123',
}

// Monta a querystring do viewport (GET /events/map/events).
export function viewportUrl(extra = {}) {
  const params = { ...BBOX, limit: 100, ...extra }
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')
  return `${BASE_URL}/events/map/events?${qs}`
}

// Faz login e devolve o JWT. Usado no setup() dos cenários autenticados.
export function login(user = SEED_USER) {
  const res = http.post(`${BASE_URL}/auth/login`, JSON.stringify(user), {
    headers: { 'Content-Type': 'application/json' },
  })
  check(res, { 'login 200': (r) => r.status === 200 })
  if (res.status !== 200) {
    throw new Error(
      `login falhou (${res.status}). Rodou 'pnpm db:seed'? body=${res.body}`,
    )
  }
  return res.json('token')
}

// Thresholds-padrão (SLO) usados como critério pass/fail no documento.
export const DEFAULT_THRESHOLDS = {
  http_req_duration: ['p(95)<500', 'p(99)<1000'],
  http_req_failed: ['rate<0.01'],
}

// handleSummary reaproveitável: grava o JSON do cenário em results/ e imprime
// um resumo legível no stdout (sem dependência de rede/jslib externa).
export function buildSummary(name) {
  return (data) => {
    const out = {}
    out[`${RESULTS_DIR}/${name}-summary.json`] = JSON.stringify(data, null, 2)
    out.stdout = textSummary(name, data)
    return out
  }
}

function metric(data, key) {
  return data.metrics[key] ? data.metrics[key].values : {}
}

function textSummary(name, data) {
  const dur = metric(data, 'http_req_duration')
  const reqs = metric(data, 'http_reqs')
  const failed = metric(data, 'http_req_failed')
  const limited = metric(data, 'rate_limited')
  const lines = [
    '',
    `══ cenário: ${name} ═══════════════════════════════════════════`,
    `  requisições .......... ${fmt(reqs.count)} (${fmt(reqs.rate, 1)} req/s)`,
    `  latência p50 ......... ${fmt(dur.med, 2)} ms`,
    `  latência p95 ......... ${fmt(dur['p(95)'], 2)} ms`,
    `  latência p99 ......... ${fmt(dur['p(99)'], 2)} ms`,
    `  latência máx ......... ${fmt(dur.max, 2)} ms`,
    `  erro (http_req_failed) ${fmt((failed.rate || 0) * 100, 2)} %`,
  ]
  if (data.metrics.rate_limited) {
    lines.push(`  respostas 429 ........ ${fmt((limited.rate || 0) * 100, 2)} %`)
  }
  lines.push(
    '════════════════════════════════════════════════════════════════',
    '',
  )
  return lines.join('\n')
}

function fmt(v, digits = 0) {
  if (v === undefined || v === null || Number.isNaN(v)) return 'n/a'
  return Number(v).toFixed(digits)
}
