/**
 * Bootstrap de observabilidade (OpenTelemetry + Sentry).
 *
 * DEVE ser o PRIMEIRO import do server.ts: o OpenTelemetry precisa instrumentar
 * `http`, `pg`, `ioredis`, Fastify e Prisma ANTES de esses módulos serem
 * carregados. Por isso este arquivo lê `process.env` CRU — importar `lib/env.ts`
 * aqui puxaria Prisma/Redis cedo demais e quebraria a instrumentação.
 *
 * Tudo é OFF por padrão: sem `SENTRY_DSN` o Sentry não sobe; sem `OTEL_ENABLED`
 * + endpoint OTLP o tracing não sobe. Em `NODE_ENV=test` é um no-op total (e o
 * `buildApp()` dos testes nem importa este arquivo).
 *
 * Decisão de arquitetura (errors-only + traces no Tempo):
 * - Sentry captura ERROS; o Grafana Tempo recebe os TRACES (via OTLP).
 * - Quando ambos estão ativos, o Sentry roda com `skipOpenTelemetrySetup` e nós
 *   ligamos só o `SentryContextManager` + `SentryPropagator` ao nosso NodeSDK.
 *   NÃO usamos `SentrySampler` (gatearia o export pro Tempo quando o sample rate
 *   do Sentry fosse 0) nem `SentrySpanProcessor` (mandaria transações ao Sentry).
 */
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions'
import { PrismaInstrumentation } from '@prisma/instrumentation'
import * as Sentry from '@sentry/node'
import {
  SentryPropagator,
  setOpenTelemetryContextAsyncContextStrategy,
  setupEventContextTrace,
} from '@sentry/opentelemetry'

function isOn(value: string | undefined): boolean {
  return value === 'true' || value === '1'
}

let sdk: NodeSDK | undefined
let sentryActive = false

function start(): void {
  if (process.env.NODE_ENV === 'test') return

  const dsn = process.env.SENTRY_DSN
  sentryActive = typeof dsn === 'string' && dsn.length > 0

  const otelActive =
    isOn(process.env.OTEL_ENABLED) &&
    typeof process.env.OTEL_EXPORTER_OTLP_ENDPOINT === 'string' &&
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT.length > 0

  if (sentryActive) {
    const client = Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? 'development',
      // Errors-only: sem `tracesSampleRate` o Sentry não envia transações.
      // Quando o nosso NodeSDK sobe, ele é o dono do OpenTelemetry — então o
      // Sentry não deve instalar o setup próprio (evita dupla instrumentação).
      skipOpenTelemetrySetup: otelActive,
    })
    if (otelActive && client) setupEventContextTrace(client)
  }

  if (!otelActive) return

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'connectai-backend',
    }),
    // Lê OTEL_EXPORTER_OTLP_ENDPOINT (e afins) das envs padrão do OTLP.
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      getNodeAutoInstrumentations({
        // ruidoso e de baixo valor para uma API HTTP
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
      new PrismaInstrumentation(),
    ],
    // Com o Sentry ativo, usa o context manager + propagator dele para que os
    // erros capturados carreguem o trace_id/span_id do span ativo.
    ...(sentryActive && {
      contextManager: new Sentry.SentryContextManager(),
      textMapPropagator: new SentryPropagator(),
    }),
  })

  sdk.start()

  // Faz o escopo do Sentry seguir o contexto assíncrono do OpenTelemetry,
  // evitando vazamento de escopo entre requests.
  if (sentryActive) setOpenTelemetryContextAsyncContextStrategy()
}

/** Drena traces e eventos pendentes no shutdown gracioso. */
export async function shutdownInstrumentation(): Promise<void> {
  if (sdk) await sdk.shutdown()
  if (sentryActive) await Sentry.flush(2000)
}

start()
