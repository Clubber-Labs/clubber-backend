/**
 * Teste de carga k6 da busca por proximidade.
 *
 * Pré-requisitos: servidor rodando contra o banco de perf (conectai_perf,
 * já populado por seed-perf.ts) e Redis ativo.
 *
 * Uso:
 *   BASE_URL=http://localhost:3333 k6 run scripts/load/proximity.js
 *
 * Cenários:
 *  - exp_feed / exp_radius / exp_distance: ramping 0→100 VUs, mapeiam a curva
 *    latência×carga (RNF01.3, threshold p95<1000 POR cenário).
 *  - cache: VUs constantes batendo as MESMAS células (mede hit-rate / RNF05.2
 *    via /metrics).
 *  - rnf014: constant-arrival-rate fixando 1000 req/s com mix realista de feed
 *    (RNF01.4: p95<500 e erro 5xx <0.1%). VU não garante RPS — só o executor
 *    de chegada constante garante.
 *
 * Erro = só status >= 500 (4xx como cap de raio / cursor inválido é esperado).
 */
import { check } from 'k6'
import http from 'k6/http'
import { Rate } from 'k6/metrics'

const BASE = __ENV.BASE_URL || 'http://localhost:3333'

const serverErrorRate = new Rate('server_error_rate')

const HOT_CELLS = [
  { lat: -23.55, lng: -46.63 }, // SP
  { lat: -22.91, lng: -43.2 }, // RJ
  { lat: -19.92, lng: -43.94 }, // BH
]

function pick() {
  return HOT_CELLS[Math.floor(Math.random() * HOT_CELLS.length)]
}

// jitter dentro da MESMA célula (~110m) — exercita o snap → cache hit
function sameCellPoint() {
  const c = pick()
  return {
    lat: c.lat + (Math.random() - 0.5) * 0.001,
    lng: c.lng + (Math.random() - 0.5) * 0.001,
  }
}

// cauda longa ao redor das cidades (~0.4° ≈ 44km) — células variadas
function tailPoint() {
  const c = pick()
  return {
    lat: c.lat + (Math.random() - 0.5) * 0.4,
    lng: c.lng + (Math.random() - 0.5) * 0.4,
  }
}

function track(res) {
  serverErrorRate.add(res.status >= 500)
  check(res, { 'status < 500': (r) => r.status < 500 })
}

const ramp = (startTime) => ({
  executor: 'ramping-vus',
  startVUs: 0,
  stages: [
    { duration: '30s', target: 100 },
    { duration: '60s', target: 100 },
  ],
  startTime,
})

export const options = {
  scenarios: {
    exp_feed: { exec: 'feed', tags: { scenario: 'exp_feed' }, ...ramp('0s') },
    exp_radius: {
      exec: 'radius',
      tags: { scenario: 'exp_radius' },
      ...ramp('90s'),
    },
    exp_distance: {
      exec: 'distance',
      tags: { scenario: 'exp_distance' },
      ...ramp('180s'),
    },
    cache: {
      executor: 'constant-vus',
      exec: 'cacheHit',
      vus: 50,
      duration: '60s',
      startTime: '270s',
      tags: { scenario: 'cache' },
    },
    rnf014: {
      executor: 'constant-arrival-rate',
      exec: 'mix',
      rate: 1000,
      timeUnit: '1s',
      duration: '60s',
      preAllocatedVUs: 200,
      maxVUs: 1000,
      startTime: '340s',
      tags: { scenario: 'rnf014' },
    },
  },
  thresholds: {
    'http_req_duration{scenario:exp_feed}': ['p(95)<1000'],
    'http_req_duration{scenario:exp_radius}': ['p(95)<1000'],
    'http_req_duration{scenario:exp_distance}': ['p(95)<1000'],
    'http_req_duration{scenario:rnf014}': ['p(95)<500'],
    'server_error_rate{scenario:rnf014}': ['rate<0.001'],
  },
}

export function feed() {
  track(http.get(`${BASE}/events`))
}

export function radius() {
  const p = tailPoint()
  track(http.get(`${BASE}/events?nearLat=${p.lat}&nearLng=${p.lng}&radiusKm=5`))
}

export function distance() {
  const p = tailPoint()
  track(
    http.get(`${BASE}/events?nearLat=${p.lat}&nearLng=${p.lng}&orderBy=distance`),
  )
}

export function cacheHit() {
  const p = sameCellPoint()
  track(
    http.get(`${BASE}/events?nearLat=${p.lat}&nearLng=${p.lng}&orderBy=distance`),
  )
}

// mix realista de feed pro RNF01.4: 70% feed geral, 20% raio, 10% distance
export function mix() {
  const r = Math.random()
  if (r < 0.7) feed()
  else if (r < 0.9) radius()
  else distance()
}
