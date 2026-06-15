// Baseline geo — carga sustentada no endpoint mais pesado (GET /events/map/events,
// query PostGIS de viewport + hidratação completa). Mede latência/throughput sob
// uma carga estável e moderada. Rode a API com RATE_LIMIT_ENABLED=false (ou
// RATE_LIMIT_MAX_FACTOR alto) para não bater no teto de 240/min.
import http from 'k6/http'
import { check } from 'k6'
import { DEFAULT_THRESHOLDS, buildSummary, viewportUrl } from './lib/helpers.js'

export const options = {
  scenarios: {
    baseline: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 20),
      duration: __ENV.DURATION || '1m',
    },
  },
  thresholds: DEFAULT_THRESHOLDS,
}

export default function () {
  const res = http.get(viewportUrl())
  check(res, {
    'status 200': (r) => r.status === 200,
    'retorna data[]': (r) => Array.isArray(r.json('data')),
  })
}

export const handleSummary = buildSummary('01-geo-baseline')
