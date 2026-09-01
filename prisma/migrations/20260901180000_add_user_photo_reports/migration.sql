-- AlterTable
ALTER TABLE "reports" ADD COLUMN     "userPhotoId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "reports_reporter_user_photo_status_unique" ON "reports"("reporterId", "userPhotoId", "status");

-- CreateIndex
CREATE INDEX "reports_reporter_user_photo_status_idx" ON "reports"("reporterId", "userPhotoId", "status");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_userPhotoId_fkey" FOREIGN KEY ("userPhotoId") REFERENCES "user_photos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
