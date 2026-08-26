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

registry.setDefaultLabels({ service: 'clubber-backend' })

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

// Quantas vezes a geração de sugestões caiu no template em vez da IA. `reason`
// distingue falha do LLM, saída inválida ou descarte total (piso). Sobe em
// silêncio hoje — esta métrica é o alarme de "IA degradada/offline".
export const suggestionsEnhancerFallbackTotal = new Counter({
  name: 'suggestions_enhancer_fallback_total',
  help: 'Sugestões que caíram no template em vez da IA, por motivo',
  labelNames: ['reason'],
  registers: [registry],
})

// Quantas vezes a composição da query de busca caiu no fallback determinístico
// em vez da IA. Mesmo papel de alarme do contador do enhancer. `method` separa
// os fluxos: profile cai nos rótulos de categoria; intent cai no texto cru do
// usuário (sem ancoragem de venue/cidade).
export const profileQueryComposerFallbackTotal = new Counter({
  name: 'profile_query_composer_fallback_total',
  help: 'Composições de query que caíram no template em vez da IA, por motivo e método',
  labelNames: ['reason', 'method'],
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

// Falhas da fila de notificações. O enqueue é best-effort de propósito (não
// pode quebrar a ação principal), então o erro é engolido com um warn — foi
// assim que o enqueue quebrado por jobId ficou invisível por meses. Este
// contador é o alarme: valor subindo = notificação sendo perdida agora.
export const notificationQueueFailuresTotal = new Counter({
  name: 'notification_queue_failures_total',
  help: 'Falhas da fila de notificações por estágio (enqueue|process) e tipo de job',
  labelNames: ['stage', 'kind'],
  registers: [registry],
})

// Quantos candidatos foram descartados por conteúdo adulto (nome de casa de
// swing/liberal/strip etc.). Filtro HARD de content-safety — acompanha o volume.
export const adultVenueFilteredTotal = new Counter({
  name: 'spots_adult_venue_filtered_total',
  help: 'Candidatos descartados por conteúdo adulto no nome',
  registers: [registry],
})

// Quantas DEKs ainda estão envelopadas numa KEK antiga, por fonte e versão. É o
// número que autoriza o último passo da rotação: só se pode remover a KEK antiga
// do ambiente quando isto zera em TODAS as fontes. Gauge (e não contador) porque
// a pergunta é "quanto falta agora", não "quanto já passou".
export const chatKekRewrapPending = new Gauge({
  name: 'chat_kek_rewrap_pending',
  help: 'DEKs pendentes de rewrap na KEK ativa, por fonte e versão de KEK',
  labelNames: ['source', 'kek_version'],
  registers: [registry],
})

// `failed` subindo é o alarme de KEK antiga removida do ambiente cedo demais —
// o material fica ilegível e o rewrap não tem como avançar.
export const chatKekRewrapTotal = new Counter({
  name: 'chat_kek_rewrap_total',
  help: 'Resultado do rewrap de DEKs por fonte (rewrapped|skipped|failed)',
  labelNames: ['source', 'result'],
  registers: [registry],
})
