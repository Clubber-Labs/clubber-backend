-- AlterTable: template de conteúdo da série (o reconciler clona daqui)
ALTER TABLE "event_series" ADD COLUMN     "title" TEXT;
ALTER TABLE "event_series" ADD COLUMN     "description" TEXT;
ALTER TABLE "event_series" ADD COLUMN     "latitude" DOUBLE PRECISION;
ALTER TABLE "event_series" ADD COLUMN     "longitude" DOUBLE PRECISION;
ALTER TABLE "event_series" ADD COLUMN     "address" TEXT;
-- Scalar list de categorias (Prisma: NOT NULL sem default). Default temporário
-- só para popular linhas de séries já existentes; séries legadas ficam com lista
-- vazia e o reconciler as pula (guard de template).
ALTER TABLE "event_series" ADD COLUMN     "categories" "EventCategory"[] NOT NULL DEFAULT ARRAY[]::"EventCategory"[];
ALTER TABLE "event_series" ALTER COLUMN "categories" DROP DEFAULT;
ALTER TABLE "event_series" ADD COLUMN     "maxCapacity" INTEGER;
ALTER TABLE "event_series" ADD COLUMN     "isPublic" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "event_series" ADD COLUMN     "durationMs" INTEGER;

-- Troca o índice (seriesId, date) por UNIQUE: idempotência da reposição e
-- segurança contra reconcilers concorrentes. seriesId NULL é distinto no
-- Postgres, então eventos avulsos não são afetados.
DROP INDEX "events_seriesId_date_idx";
CREATE UNIQUE INDEX "events_seriesId_date_key" ON "events"("seriesId", "date");
