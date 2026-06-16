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

// ── Business metrics ─────────────────────────────────────────────────────────

// Quantas vezes a geração de sugestões caiu no template em vez da IA. `reason`
// distingue falha do LLM, saída inválida ou descarte total (piso). Sobe em
// silêncio hoje — esta métrica é o alarme de "IA degradada/offline".
export const suggestionsEnhancerFallbackTotal = new Counter({
  name: 'suggestions_enhancer_fallback_total',
  help: 'Sugestões que caíram no template em vez da IA, por motivo',
  labelNames: ['reason'],
  registers: [registry],
})

// Quantas vezes a composição da query de busca (modo-perfil) caiu no fallback
// determinístico em vez da IA. Mesmo papel de alarme do contador do enhancer.
export const profileQueryComposerFallbackTotal = new Counter({
  name: 'profile_query_composer_fallback_total',
  help: 'Composições de query que caíram no template em vez da IA, por motivo',
  labelNames: ['reason'],
  registers: [registry],
})

// Chamadas à API do Places por tipo de busca. Text Search e Nearby Search são
// SKUs de custo diferentes — esta métrica acompanha o volume (e o custo) de cada.
export const placesSearchTotal = new Counter({
  name: 'places_search_total',
  help: 'Chamadas à API do Places por tipo de busca (custo por SKU)',
  labelNames: ['type'],
  registers: [registry],
})

// Quantas gerações tiveram o filtro de venue social zerando uma lista não-vazia
// (todos os candidatos eram não-sociais). Nesses casos o filtro é bypassado para
// não devolver 0 sugestões após gastar quota — este contador é o alarme de
// "filtro agressivo demais" (recalibrar a whitelist/blacklist).
export const socialFilterEmptyTotal = new Counter({
  name: 'spots_social_filter_empty_total',
  help: 'Gerações em que o filtro de venue social zerou uma lista não-vazia',
  registers: [registry],
})

// Quantos candidatos foram descartados por conteúdo adulto (nome de casa de
// swing/liberal/strip etc.). Filtro HARD de content-safety — acompanha o volume.
export const adultVenueFilteredTotal = new Counter({
  name: 'spots_adult_venue_filtered_total',
  help: 'Candidatos descartados por conteúdo adulto no nome',
  registers: [registry],
})
