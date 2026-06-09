-- CreateEnum
CREATE TYPE "AccountLifecycleAction" AS ENUM ('DEACTIVATED', 'DELETION_SCHEDULED', 'REACTIVATED');

-- CreateTable
CREATE TABLE "account_lifecycle_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" "AccountLifecycleAction" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "account_lifecycle_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "account_lifecycle_logs_userId_idx" ON "account_lifecycle_logs"("userId");

-- CreateIndex
CREATE INDEX "account_lifecycle_logs_action_createdAt_idx" ON "account_lifecycle_logs"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "account_lifecycle_logs" ADD CONSTRAINT "account_lifecycle_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
