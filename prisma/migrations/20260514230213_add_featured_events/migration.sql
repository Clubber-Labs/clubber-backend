-- AlterTable
ALTER TABLE "users" ADD COLUMN "isPremium" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "events" ADD COLUMN "isFeatured" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "featured_events" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "canceledAt" TIMESTAMP(3),

    CONSTRAINT "featured_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "events_isFeatured_date_id_idx" ON "events"("isFeatured", "date", "id");

-- CreateIndex
CREATE INDEX "featured_events_eventId_canceledAt_startsAt_endsAt_idx" ON "featured_events"("eventId", "canceledAt", "startsAt", "endsAt");

-- AddForeignKey
ALTER TABLE "featured_events" ADD CONSTRAINT "featured_events_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "featured_events" ADD CONSTRAINT "featured_events_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
