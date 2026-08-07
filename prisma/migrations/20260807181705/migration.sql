/*
  Warnings:

  - You are about to drop the column `location` on the `events` table. All the data in the column will be lost.
  - You are about to drop the column `location` on the `spots` table. All the data in the column will be lost.
  - You are about to drop the column `location` on the `users` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "consent_audit_logs" DROP CONSTRAINT "consent_audit_logs_userId_fkey";

-- DropForeignKey
ALTER TABLE "user_consents" DROP CONSTRAINT "user_consents_userId_fkey";

-- DropIndex
DROP INDEX "event_series_subcategories_idx";

-- DropIndex
DROP INDEX "events_location_idx";

-- DropIndex
DROP INDEX "spots_location_idx";

-- DropIndex
DROP INDEX "user_consents_userId_idx";

-- DropIndex
DROP INDEX "users_location_idx";

-- AlterTable
ALTER TABLE "consent_audit_logs" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "changedFields" DROP DEFAULT,
ALTER COLUMN "consentVersion" DROP DEFAULT,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "events" DROP COLUMN "location";

-- AlterTable
ALTER TABLE "spots" DROP COLUMN "location";

-- AlterTable
ALTER TABLE "user_consents" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "collectedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "revokedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" DROP COLUMN "location";

-- AddForeignKey
ALTER TABLE "user_consents" ADD CONSTRAINT "user_consents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_audit_logs" ADD CONSTRAINT "consent_audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
