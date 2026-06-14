// 06 — Escala horizontal. Aplica a MESMA carga contra o cluster com 1, 2 e 3
// réplicas atrás do load balancer (nginx), evidenciando o RNF05.1. Endpoint
// geoespacial mais pesado (GET /events/map/events), reusando os utilitários
// compartilhados (lib/helpers.js).
//
// Aponte K6_BASE_URL para o LB (não para uma réplica):
//   k6 run -e K6_BASE_URL=http://localhost:3333 -e VUS=50 load-tests/06-cluster-scale.js
//
// Compare entre os números de réplicas: RPS sustentado (http_reqs.rate) e p95.
// CPU por réplica: `docker stats` durante o teste. Ver "Escala horizontal
// (cluster)" no README para subir o cluster.
//
// Modelo fechado (constant-vus): cada VU espera a resposta antes da próxima
// requisição — não enfileira sem limite. O viewport é pesado, então este modelo
// dá RPS/p95 comparáveis entre os números de réplicas (segue o 01-geo-baseline).
// Com constant-arrival-rate, uma instância colapsa em timeouts neste endpoint.
import http from 'k6/http'
import { check } from 'k6'
import { buildSummary, viewportUrl } from './lib/helpers.js'

const VUS = Number(__ENV.VUS || 50)

export const options = {
  scenarios: {
    scale: {
      executor: 'constant-vus',
      vus: VUS,
      duration: __ENV.DURATION || '45s',
    },
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
}

export default function () {
  const res = http.get(viewportUrl())
  check(res, { 'status 200': (r) => r.status === 200 })
}

export const handleSummary = buildSummary('06-cluster-scale')
