-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'USER';

-- AlterTable
ALTER TABLE "reports"
ADD COLUMN "targetUserId" TEXT,
ADD COLUMN "reviewerId" TEXT,
ADD COLUMN "resolutionNote" TEXT;

-- CreateIndex
CREATE INDEX "reports_reporter_target_user_status_idx" ON "reports"("reporterId", "targetUserId", "status");

-- CreateIndex
CREATE INDEX "reports_reviewer_idx" ON "reports"("reviewerId");

-- CreateIndex
CREATE INDEX "reports_status_created_at_id_idx" ON "reports"("status", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "reports_reporter_target_user_status_unique" ON "reports"("reporterId", "targetUserId", "status");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
