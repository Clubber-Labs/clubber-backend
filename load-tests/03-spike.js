// Spike test — pico súbito de tráfego (ex.: push notification disparando o app
// de muitos usuários ao mesmo tempo) sobre o endpoint geo. Usa arrival-rate
// (req/s fixos, independente da latência) pra simular demanda externa real.
// Rode a API com RATE_LIMIT_ENABLED=false para medir a resposta ao pico.
import http from 'k6/http'
import { check } from 'k6'
import { buildSummary, viewportUrl } from './lib/helpers.js'

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 500,
      stages: [
        { duration: '20s', target: 20 }, // tráfego normal
        { duration: '10s', target: 500 }, // PICO súbito
        { duration: '30s', target: 500 }, // sustenta o pico
        { duration: '10s', target: 20 }, // volta ao normal
        { duration: '20s', target: 20 }, // recuperação
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<1000'],
    http_req_failed: ['rate<0.10'],
  },
}

export default function () {
  const res = http.get(viewportUrl())
  check(res, { 'status 200': (r) => r.status === 200 })
}

export const handleSummary = buildSummary('03-spike')
