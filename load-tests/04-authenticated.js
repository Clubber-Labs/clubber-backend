// Cenário autenticado — exercita o caminho real do app logado. O setup() faz
// login uma vez (usuário do seed) e compartilha o JWT entre os VUs, que então
// alternam entre o feed personalizado e a listagem de eventos com Bearer token.
import http from 'k6/http'
import { check } from 'k6'
import { BASE_URL, buildSummary, login } from './lib/helpers.js'

export const options = {
  scenarios: {
    authenticated: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 20),
      duration: __ENV.DURATION || '1m',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<800'],
    http_req_failed: ['rate<0.01'],
  },
}

// Roda 1x antes da carga: obtém o token e o repassa ao default() via retorno.
export function setup() {
  return { token: login() }
}

export default function (data) {
  const params = {
    headers: { Authorization: `Bearer ${data.token}` },
  }

  const feed = http.get(`${BASE_URL}/feed`, params)
  check(feed, { 'feed 200': (r) => r.status === 200 })

  const events = http.get(`${BASE_URL}/events`, params)
  check(events, { 'events 200': (r) => r.status === 200 })
}

export const handleSummary = buildSummary('04-authenticated')
