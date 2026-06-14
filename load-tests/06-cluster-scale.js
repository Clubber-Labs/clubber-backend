// 06 — Escala horizontal. Aplica a MESMA carga (taxa fixa de chegada) contra o
// cluster com 1, 2 e 3 réplicas atrás do load balancer (nginx), evidenciando o
// RNF05.1. Endpoint geoespacial mais pesado (GET /events/map/events), reusando
// os utilitários compartilhados (lib/helpers.js).
//
// Aponte K6_BASE_URL para o LB (não para uma réplica):
//   k6 run -e K6_BASE_URL=http://localhost:3333 -e RATE=600 load-tests/06-cluster-scale.js
//
// Compare entre os números de réplicas: RPS sustentado, p95 e dropped_iterations.
// CPU por réplica: `docker stats` durante o teste. Ver "Escala horizontal
// (cluster)" no README para subir o cluster.
import http from 'k6/http'
import { check } from 'k6'
import { buildSummary, viewportUrl } from './lib/helpers.js'

const RATE = Number(__ENV.RATE || 600) // req/s alvo (override: -e RATE=800)

export const options = {
  scenarios: {
    scale: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: __ENV.DURATION || '45s',
      preAllocatedVUs: 300,
      maxVUs: 2000,
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
}

export default function () {
  const res = http.get(viewportUrl())
  check(res, { 'status 200': (r) => r.status === 200 })
}

export const handleSummary = buildSummary('06-cluster-scale')
