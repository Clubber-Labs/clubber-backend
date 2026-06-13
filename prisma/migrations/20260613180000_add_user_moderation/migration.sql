-- AlterEnum: estados de moderação no ciclo de vida da conta
ALTER TYPE "AccountStatus" ADD VALUE 'SUSPENDED';
ALTER TYPE "AccountStatus" ADD VALUE 'BANNED';

-- AlterEnum: ações de moderação no log append-only
ALTER TYPE "AccountLifecycleAction" ADD VALUE 'SUSPENDED';
ALTER TYPE "AccountLifecycleAction" ADD VALUE 'BANNED';
ALTER TYPE "AccountLifecycleAction" ADD VALUE 'UNSUSPENDED';

-- AlterTable: marcadores da suspensão/banimento
ALTER TABLE "users"
  ADD COLUMN "suspendedAt" TIMESTAMP(3),
  ADD COLUMN "suspendedUntil" TIMESTAMP(3),
  ADD COLUMN "suspensionReason" TEXT;

-- CreateIndex: alvo do reconciler de expiração
CREATE INDEX "users_accountStatus_suspendedUntil_idx" ON "users"("accountStatus", "suspendedUntil");
