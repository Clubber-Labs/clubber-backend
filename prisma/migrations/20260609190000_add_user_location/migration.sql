-- AlterTable: campos relacionais de localização (no schema.prisma)
ALTER TABLE "users" ADD COLUMN     "locationGeohash" TEXT,
ADD COLUMN     "locationUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "notifyRadiusKm" INTEGER NOT NULL DEFAULT 10;

-- Coluna geográfica derivada do geohash (mantida em sincronia automaticamente),
-- fora do schema.prisma — mesmo padrão de events.location. ST_PointFromGeoHash é
-- IMMUTABLE e retorna NULL para geohash NULL (usuário sem localização).
ALTER TABLE "users" ADD COLUMN "location" geography(Point, 4326)
    GENERATED ALWAYS AS (ST_PointFromGeoHash("locationGeohash")::geography) STORED;

-- Índice espacial GiST para a query invertida (ST_DWithin / ST_Distance).
CREATE INDEX "users_location_idx" ON "users" USING GIST ("location");
