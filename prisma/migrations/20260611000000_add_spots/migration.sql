-- CreateEnum
CREATE TYPE "SpotVisibility" AS ENUM ('PUBLIC', 'FRIENDS');

-- CreateTable
CREATE TABLE "spots" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "categories" "EventCategory"[],
    "visibility" "SpotVisibility" NOT NULL DEFAULT 'PUBLIC',
    "placeId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "creatorId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,

    CONSTRAINT "spots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "spots_conversationId_key" ON "spots"("conversationId");

-- CreateIndex
CREATE INDEX "spots_creatorId_idx" ON "spots"("creatorId");

-- CreateIndex (GIN para filtro/match por interseção de categorias)
CREATE INDEX "spots_categories_idx" ON "spots" USING GIN ("categories");

-- AddForeignKey
ALTER TABLE "spots" ADD CONSTRAINT "spots_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spots" ADD CONSTRAINT "spots_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- PostGIS: coluna geográfica derivada de longitude/latitude + índice GiST,
-- mantida em sincronia automaticamente (igual events.location).
ALTER TABLE "spots" ADD COLUMN "location" geography(Point, 4326)
    GENERATED ALWAYS AS (
        ST_SetSRID(ST_MakePoint("longitude", "latitude"), 4326)::geography
    ) STORED;

CREATE INDEX "spots_location_idx" ON "spots" USING GIST ("location");
