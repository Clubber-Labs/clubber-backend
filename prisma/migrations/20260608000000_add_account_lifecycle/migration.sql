-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'DEACTIVATED', 'PENDING_DELETION', 'ANONYMIZED');

-- AlterTable
ALTER TABLE "users"
  ADD COLUMN "accountStatus" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "deactivatedAt" TIMESTAMP(3),
  ADD COLUMN "scheduledDeletionAt" TIMESTAMP(3),
  ADD COLUMN "anonymizedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "users_accountStatus_scheduledDeletionAt_idx" ON "users"("accountStatus", "scheduledDeletionAt");
