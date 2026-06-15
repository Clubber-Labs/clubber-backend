// Smoke test — sanidade + linha de base de latência com 1 VU no /health.
// Garante que a API está no ar e mede a latência "sem carga" (referência).
import http from 'k6/http'
import { check } from 'k6'
import { BASE_URL, buildSummary } from './lib/helpers.js'

export const options = {
  vus: 1,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<200'],
    http_req_failed: ['rate==0'],
  },
}

export default function () {
  const res = http.get(`${BASE_URL}/health`)
  check(res, {
    'status 200': (r) => r.status === 200,
    'status ok no body': (r) => String(r.body).includes('ok'),
  })
}

export const handleSummary = buildSummary('00-smoke')
