import {
  Counter,
  collectDefaultMetrics,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client'

/**
 * Registry dedicado (não o global do prom-client) para que /metrics seja
 * determinístico e não colida com métricas registradas por outras libs.
 *
 * IMPORTANTE: as métricas abaixo são singletons de MÓDULO — criadas uma única
 * vez no import. Nunca crie métricas dentro de um handler/plugin: o prom-client
 * lança "metric already registered" se o mesmo nome for registrado duas vezes
 * no mesmo registry.
 */
export const registry = new Registry()

registry.setDefaultLabels({ service: 'connectai-backend' })

// Métricas de processo: event loop lag, heap, GC, CPU, handles abertos.
collectDefaultMetrics({ register: registry })

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total de requisições HTTP recebidas',
  labelNames: ['method', 'route', 'status_code'],
  registers: [registry],
})

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duração das requisições HTTP em segundos',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
})

export const httpRequestsInFlight = new Gauge({
  name: 'http_requests_in_flight',
  help: 'Requisições HTTP em andamento',
  labelNames: ['method'],
  registers: [registry],
})

// ── Business metrics hook ────────────────────────────────────────────────────
// Para métricas de negócio, importe `registry` neste arquivo (ou no módulo de
// destino) e crie o Counter/Gauge/Histogram em escopo de módulo, sempre com
// `registers: [registry]`. Ex.:
//
//   export const eventsCreatedTotal = new Counter({
//     name: 'events_created_total',
//     help: 'Total de eventos criados',
//     registers: [registry],
//   })
