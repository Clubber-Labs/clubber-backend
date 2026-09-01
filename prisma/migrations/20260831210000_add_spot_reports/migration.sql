-- AlterTable
ALTER TABLE "reports" ADD COLUMN     "spotId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "reports_reporter_spot_status_unique" ON "reports"("reporterId", "spotId", "status");

-- CreateIndex
CREATE INDEX "reports_reporter_spot_status_idx" ON "reports"("reporterId", "spotId", "status");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_spotId_fkey" FOREIGN KEY ("spotId") REFERENCES "spots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
