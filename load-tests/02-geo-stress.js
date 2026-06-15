// Stress test — sobe a carga em rampa no endpoint geo até a latência degradar,
// para localizar o ponto de quebra (joelho da curva latência × carga). Os
// thresholds NÃO abortam: queremos observar a degradação, não pará-la.
// Rode a API com RATE_LIMIT_ENABLED=false para medir o limite real do sistema.
import http from 'k6/http'
import { check } from 'k6'
import { buildSummary, viewportUrl } from './lib/helpers.js'

export const options = {
  scenarios: {
    stress: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 25 },
        { duration: '30s', target: 50 },
        { duration: '30s', target: 100 },
        { duration: '30s', target: 200 },
        { duration: '30s', target: 300 },
        { duration: '20s', target: 0 },
      ],
    },
  },
  // Apenas registra o SLO (p95<500). abortOnFail desligado de propósito.
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.05'],
  },
}

export default function () {
  const res = http.get(viewportUrl())
  check(res, { 'status 200': (r) => r.status === 200 })
}

export const handleSummary = buildSummary('02-geo-stress')
