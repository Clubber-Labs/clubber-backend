-- CreateEnum
CREATE TYPE "RecurrenceFrequency" AS ENUM ('WEEKLY', 'MONTHLY');

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "seriesId" TEXT;

-- CreateTable
CREATE TABLE "event_series" (
    "id" TEXT NOT NULL,
    "frequency" "RecurrenceFrequency" NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "until" TIMESTAMP(3),
    "count" INTEGER,
    "authorId" TEXT NOT NULL,
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_series_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_series_canceledAt_until_idx" ON "event_series"("canceledAt", "until");

-- CreateIndex
CREATE INDEX "events_seriesId_date_idx" ON "events"("seriesId", "date");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "event_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_series" ADD CONSTRAINT "event_series_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
