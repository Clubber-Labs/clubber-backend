-- Métricas premium de eventos exigidas pelo TCC US015/RF11.3:
-- visualizações e compartilhamentos. Confirmações continuam vindo de
-- event_attendances, que já é a fonte de verdade de presença no app.
CREATE TYPE "EventAnalyticsMetricType" AS ENUM ('VIEW', 'SHARE');

CREATE TABLE "event_analytics_metrics" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" "EventAnalyticsMetricType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_analytics_metrics_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "event_analytics_metrics_eventId_type_occurredAt_idx"
    ON "event_analytics_metrics"("eventId", "type", "occurredAt");

ALTER TABLE "event_analytics_metrics"
    ADD CONSTRAINT "event_analytics_metrics_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "events"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
