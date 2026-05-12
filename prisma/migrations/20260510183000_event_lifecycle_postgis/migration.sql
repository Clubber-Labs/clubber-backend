-- Habilita PostGIS (idempotente)
CREATE EXTENSION IF NOT EXISTS postgis;

-- Adiciona campo opcional de fim do evento
ALTER TABLE "events" ADD COLUMN "endDate" TIMESTAMP(3);

-- Coluna geográfica derivada de longitude/latitude (mantida em sincronia automaticamente)
ALTER TABLE "events" ADD COLUMN "location" geography(Point, 4326)
    GENERATED ALWAYS AS (
        ST_SetSRID(ST_MakePoint("longitude", "latitude"), 4326)::geography
    ) STORED;

-- Índices para ordenação e filtros temporais
CREATE INDEX "events_date_idx" ON "events"("date");
CREATE INDEX "events_isPublic_date_idx" ON "events"("isPublic", "date");

-- Índice espacial GiST para queries de bbox / ST_DWithin / KNN
CREATE INDEX "events_location_idx" ON "events" USING GIST ("location");
