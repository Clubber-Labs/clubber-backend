// Demonstração do rate limiting — martela um endpoint de teto baixo
// (GET /events/search, 30/min por IP) acima do limite e mede a fração de 429.
// É o experimento que amarra as duas entregas: rode DUAS vezes e compare:
//
//   1) API com rate limit LIGADO (default):  espera-se ~429 entrando no teto
//        pnpm dev                 (RATE_LIMIT_ENABLED=true)
//        k6 run -e PHASE=on  load-tests/05-rate-limit-demo.js
//
//   2) API com rate limit DESLIGADO: espera-se 0% de 429, throughput cheio
//        RATE_LIMIT_ENABLED=false pnpm dev
//        k6 run -e PHASE=off load-tests/05-rate-limit-demo.js
//
// O sufixo PHASE só nomeia o arquivo de saída (results/05-rate-limit-demo-on/off).
import http from 'k6/http'
import { check } from 'k6'
import { Rate } from 'k6/metrics'
import { BASE_URL, buildSummary } from './lib/helpers.js'

// Fração de respostas 429 (Too Many Requests) — a evidência do throttling.
const rateLimited = new Rate('rate_limited')

const PHASE = __ENV.PHASE || 'on'

export const options = {
  scenarios: {
    hammer: {
      // 50 req/s sustentados por 30s = 1500 reqs >> teto de 30/min.
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE || 50),
      timeUnit: '1s',
      duration: __ENV.DURATION || '30s',
      preAllocatedVUs: 20,
      maxVUs: 100,
    },
  },
  // Sem threshold de http_req_failed: aqui o 429 é o resultado ESPERADO (fase on),
  // não uma falha. A métrica rate_limited conta a proporção.
}

export default function () {
  const res = http.get(`${BASE_URL}/events/search?q=festa`)
  rateLimited.add(res.status === 429)
  check(res, {
    'status 200 ou 429': (r) => r.status === 200 || r.status === 429,
  })
}

export const handleSummary = buildSummary(`05-rate-limit-demo-${PHASE}`)
